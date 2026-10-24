package com.patrickspdf.app;

import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.Environment;
import android.os.ParcelFileDescriptor;
import android.print.PageRange;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintDocumentInfo;
import android.print.PrintManager;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.widget.Toast;

import androidx.core.content.FileProvider;
import com.getcapacitor.BridgeActivity;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.FileInputStream;
import java.io.RandomAccessFile;
import java.net.ServerSocket;
import java.net.InetAddress;
import java.net.Socket;
import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.ArrayList;

public class MainActivity extends BridgeActivity {
    private static final String TAG = "PatricksPDF_Native";
    private volatile String pendingPdfJson = null;
    private volatile File incomingPdfFile = null;
    private volatile String incomingPdfToken = null;

    public static class NativePdfBridgeInterface {
        private final MainActivity activity;

        public NativePdfBridgeInterface(MainActivity activity) {
            this.activity = activity;
        }

        @JavascriptInterface
        public String getPendingPdf() {
            String res = activity.pendingPdfJson;
            activity.pendingPdfJson = null;
            return res;
        }

        @JavascriptInterface
        public synchronized String readIncomingPdfChunk(String token, int offset) {
            if (token == null || !token.equals(activity.incomingPdfToken) || offset < 0) return "";
            File file = activity.incomingPdfFile;
            if (file == null) return "";
            try (RandomAccessFile stream = new RandomAccessFile(file, "r")) {
                if (offset >= stream.length()) return "";
                stream.seek(offset);
                byte[] buffer = new byte[(int) Math.min(48 * 1024L, stream.length() - offset)];
                stream.readFully(buffer);
                return Base64.encodeToString(buffer, Base64.NO_WRAP);
            } catch (Exception e) {
                Log.e(TAG, "Failed reading incoming PDF chunk", e);
                return "";
            }
        }

        @JavascriptInterface
        public synchronized void releaseIncomingPdf(String token) {
            if (token != null && token.equals(activity.incomingPdfToken)) {
                if (activity.incomingPdfFile != null) activity.incomingPdfFile.delete();
                activity.incomingPdfFile = null;
                activity.incomingPdfToken = null;
            }
        }

        @JavascriptInterface
        public boolean isNativeBridge() {
            return true;
        }

        /**
         * PDF hyperlinks open in the user's external browser. Android
         * WebView's window.open() does not create a browser tab by default.
         * Restrict URI schemes so an untrusted PDF cannot launch content:,
         * file:, javascript:, intent: or app-private handlers.
         */
        @JavascriptInterface
        public boolean openExternalUrl(final String value) {
            try {
                if (value == null) return false;
                final Uri uri = Uri.parse(value);
                final String scheme = uri.getScheme();
                if (scheme == null ||
                    !(scheme.equalsIgnoreCase("https") || scheme.equalsIgnoreCase("http")) ||
                    uri.getHost() == null || uri.getHost().isEmpty()) {
                    return false;
                }
                final Intent intent = new Intent(Intent.ACTION_VIEW, uri);
                intent.addCategory(Intent.CATEGORY_BROWSABLE);
                activity.runOnUiThread(() -> {
                    try {
                        activity.startActivity(intent);
                    } catch (Exception error) {
                        Log.e(TAG, "Failed to launch PDF web hyperlink", error);
                        Toast.makeText(activity, "Weblink konnte nicht geöffnet werden", Toast.LENGTH_SHORT).show();
                    }
                });
                return true;
            } catch (Exception error) {
                Log.e(TAG, "Invalid PDF hyperlink", error);
                return false;
            }
        }

        // File-backed transfer: each JS bridge message is at most 64 KiB of binary PDF.
        // Base64 is used only for individual bridge chunks, never for an entire document.
        private File transferFile;
        private String transferToken;
        private ServerSocket binaryServer;

        @JavascriptInterface
        public synchronized String beginPdfTransfer() {
            cancelPdfTransfer();
            try {
                transferToken = UUID.randomUUID().toString();
                transferFile = new File(activity.getCacheDir(), "pdf-transfer-" + transferToken + ".tmp");
                if (!transferFile.createNewFile()) throw new IllegalStateException("Transfer file already exists");
                return transferToken;
            } catch (Exception e) {
                Log.e(TAG, "Cannot start PDF transfer", e);
                transferFile = null;
                transferToken = null;
                return "";
            }
        }

        /**
         * Short-lived, loopback-only binary transfer. The WebView sends its Blob
         * directly as an HTTP request body: no Base64 or JS byte-string copies.
         * Existing bounded chunks remain as compatibility fallback.
         */
        @JavascriptInterface
        public synchronized String getBinaryTransferUrl(String token) {
            if (transferFile == null || token == null || !token.equals(transferToken)) return "";
            try {
                if (binaryServer != null) binaryServer.close();
                binaryServer = new ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"));
                binaryServer.setSoTimeout(30000);
                final ServerSocket listener = binaryServer;
                final File target = transferFile;
                final String secret = token;
                new Thread(() -> {
                    try {
                        // Some WebViews preflight localhost/private-network requests.
                        for (int attempt = 0; attempt < 2; attempt++) {
                            try (Socket socket = listener.accept()) {
                        socket.setSoTimeout(30000);
                        BufferedInputStream in = new BufferedInputStream(socket.getInputStream());
                        BufferedOutputStream out = new BufferedOutputStream(socket.getOutputStream());
                        String request = readHttpLine(in);
                        boolean preflight = request != null && request.equals("OPTIONS /pdf/" + secret + " HTTP/1.1");
                        boolean accepted = request != null && request.equals("POST /pdf/" + secret + " HTTP/1.1");
                        long length = -1;
                        String header;
                        while ((header = readHttpLine(in)) != null && !header.isEmpty()) {
                            if (header.toLowerCase(java.util.Locale.ROOT).startsWith("content-length:")) {
                                try { length = Long.parseLong(header.substring(15).trim()); } catch (Exception ignored) {}
                            }
                        }
                        if (preflight) {
                            respondBinaryUpload(out, "204 No Content", "");
                            continue;
                        }
                        if (accepted && length >= 0 && length <= 512L * 1024 * 1024) {
                            long remaining = length;
                            try (FileOutputStream fileOut = new FileOutputStream(target, false)) {
                                byte[] buffer = new byte[65536];
                                while (remaining > 0) {
                                    int n = in.read(buffer, 0, (int) Math.min(buffer.length, remaining));
                                    if (n < 0) throw new java.io.EOFException();
                                    fileOut.write(buffer, 0, n);
                                    remaining -= n;
                                }
                                fileOut.flush();
                            }
                            respondBinaryUpload(out, "200 OK", "ok");
                        } else {
                            respondBinaryUpload(out, "400 Bad Request", "invalid upload");
                        }
                        break;
                            }
                        }
                    } catch (Exception e) {
                        Log.w(TAG, "Binary PDF upload unavailable, chunk fallback possible", e);
                    } finally {
                        try { listener.close(); } catch (Exception ignored) {}
                    }
                }, "pdf-binary-upload").start();
                return "http://127.0.0.1:" + listener.getLocalPort() + "/pdf/" + secret;
            } catch (Exception e) {
                Log.w(TAG, "Cannot start binary upload", e);
                return "";
            }
        }

        private static String readHttpLine(InputStream in) throws java.io.IOException {
            StringBuilder text = new StringBuilder();
            int ch;
            while ((ch = in.read()) != -1) {
                if (ch == '\n') break;
                if (ch != '\r') text.append((char) ch);
                if (text.length() > 8192) throw new java.io.IOException("Header line too long");
            }
            if (ch == -1) return null;
            return text.toString();
        }

        private static void respondBinaryUpload(OutputStream out, String status, String body) throws java.io.IOException {
            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            String headers = "HTTP/1.1 " + status + "\r\n" +
                "Access-Control-Allow-Origin: https://localhost\r\n" +
                "Access-Control-Allow-Methods: POST, OPTIONS\r\n" +
                "Access-Control-Allow-Headers: Content-Type\r\n" +
                "Access-Control-Allow-Private-Network: true\r\n" +
                "Content-Type: text/plain\r\n" +
                "Content-Length: " + bytes.length + "\r\n" +
                "Connection: close\r\n\r\n";
            out.write(headers.getBytes(StandardCharsets.UTF_8));
            out.write(bytes);
            out.flush();
        }

        @JavascriptInterface
        public synchronized void resetPdfTransfer(String token) {
            if (transferFile == null || !token.equals(transferToken)) return;
            try {
                if (binaryServer != null) binaryServer.close();
                binaryServer = null;
                try (FileOutputStream ignored = new FileOutputStream(transferFile, false)) {}
            } catch (Exception e) { Log.w(TAG, "Could not reset binary transfer", e); }
        }

        @JavascriptInterface
        public synchronized boolean appendPdfChunk(String token, String chunkBase64) {
            if (transferFile == null || !token.equals(transferToken)) return false;
            try (FileOutputStream stream = new FileOutputStream(transferFile, true)) {
                stream.write(Base64.decode(chunkBase64, Base64.DEFAULT));
                return true;
            } catch (Exception e) {
                Log.e(TAG, "Failed appending PDF transfer chunk", e);
                return false;
            }
        }

        @JavascriptInterface
        public synchronized void cancelPdfTransfer() {
            if (binaryServer != null) {
                try { binaryServer.close(); } catch (Exception ignored) {}
                binaryServer = null;
            }
            if (transferFile != null) transferFile.delete();
            transferFile = null;
            transferToken = null;
        }

        private static String safePdfName(String name) {
            String safe = name == null ? "document.pdf" : name.replace('/', '_').replace('\\', '_').trim();
            if (safe.isEmpty() || ".".equals(safe) || "..".equals(safe)) safe = "document.pdf";
            if (!safe.toLowerCase(java.util.Locale.ROOT).endsWith(".pdf")) safe += ".pdf";
            return safe;
        }

        private static void copyPdf(File source, OutputStream destination) throws java.io.IOException {
            try (InputStream input = new FileInputStream(source)) {
                byte[] buffer = new byte[65536];
                int count;
                while ((count = input.read(buffer)) != -1) destination.write(buffer, 0, count);
                destination.flush();
            }
        }

        @JavascriptInterface
        public synchronized boolean finishPdfTransfer(String token, String action, String name) {
            if (transferFile == null || !token.equals(transferToken)) return false;
            File source = transferFile;
            String safeName = safePdfName(name);
            try {
                if (source.length() == 0) return false;
                if ("save".equals(action)) {
                    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return false;
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.MediaColumns.DISPLAY_NAME, safeName);
                    values.put(MediaStore.MediaColumns.MIME_TYPE, "application/pdf");
                    values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                    values.put(MediaStore.MediaColumns.IS_PENDING, 1);
                    Uri uri = activity.getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                    if (uri == null) return false;
                    try {
                        try (OutputStream out = activity.getContentResolver().openOutputStream(uri)) {
                            if (out == null) throw new java.io.IOException("No destination stream");
                            copyPdf(source, out);
                        }
                        values.clear();
                        values.put(MediaStore.MediaColumns.IS_PENDING, 0);
                        activity.getContentResolver().update(uri, values, null, null);
                    } catch (Exception e) {
                        activity.getContentResolver().delete(uri, null, null);
                        throw e;
                    }
                    activity.runOnUiThread(() -> Toast.makeText(activity, "PDF gespeichert: " + safeName, Toast.LENGTH_LONG).show());
                    return true;
                }
                if ("share".equals(action)) {
                    File dir = new File(activity.getCacheDir(), "shared_pdfs");
                    if (!dir.exists() && !dir.mkdirs()) return false;
                    File dest = new File(dir, safeName);
                    try (OutputStream out = new FileOutputStream(dest)) { copyPdf(source, out); }
                    Uri uri = FileProvider.getUriForFile(activity, activity.getPackageName() + ".fileprovider", dest);
                    Intent intent = new Intent(Intent.ACTION_SEND);
                    intent.setType("application/pdf");
                    intent.putExtra(Intent.EXTRA_STREAM, uri);
                    intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    activity.runOnUiThread(() -> activity.startActivity(Intent.createChooser(intent, "PDF teilen")));
                    return true;
                }
                if ("print".equals(action)) {
                    // The spooler callback is asynchronous: retain the backing file until onWrite completes.
                    File dir = new File(activity.getCacheDir(), "print_pdfs");
                    if (!dir.exists() && !dir.mkdirs()) return false;
                    File dest = new File(dir, UUID.randomUUID() + ".pdf");
                    try (OutputStream out = new FileOutputStream(dest)) { copyPdf(source, out); }
                    activity.runOnUiThread(() -> {
                        PrintManager manager = (PrintManager) activity.getSystemService(Context.PRINT_SERVICE);
                        if (manager == null) { dest.delete(); return; }
                        manager.print(safeName, new PrintDocumentAdapter() {
                            @Override public void onLayout(PrintAttributes oldA, PrintAttributes newA,
                                CancellationSignal signal, LayoutResultCallback callback, Bundle extras) {
                                if (signal.isCanceled()) { callback.onLayoutCancelled(); return; }
                                callback.onLayoutFinished(new PrintDocumentInfo.Builder(safeName)
                                    .setContentType(PrintDocumentInfo.CONTENT_TYPE_DOCUMENT)
                                    .setPageCount(PrintDocumentInfo.PAGE_COUNT_UNKNOWN).build(), true);
                            }
                            @Override public void onWrite(PageRange[] pages, ParcelFileDescriptor destination,
                                CancellationSignal signal, WriteResultCallback callback) {
                                try (OutputStream out = new FileOutputStream(destination.getFileDescriptor())) {
                                    if (signal.isCanceled()) { callback.onWriteCancelled(); return; }
                                    copyPdf(dest, out);
                                    callback.onWriteFinished(new PageRange[]{PageRange.ALL_PAGES});
                                } catch (Exception e) { callback.onWriteFailed(e.getMessage()); }
                            }
                            @Override public void onFinish() { dest.delete(); }
                        }, new PrintAttributes.Builder().build());
                    });
                    return true;
                }
                return false;
            } catch (Exception e) {
                Log.e(TAG, "File-backed PDF action failed", e);
                return false;
            } finally {
                cancelPdfTransfer();
            }
        }


        @JavascriptInterface
        public boolean savePdf(final String fileName, final String base64Data) {
            try {
                String safeName = (fileName == null || fileName.trim().isEmpty()) ? "document.pdf" : fileName;
                if (!safeName.toLowerCase().endsWith(".pdf")) {
                    safeName += ".pdf";
                }
                final String finalFileName = safeName;
                final byte[] pdfBytes = Base64.decode(base64Data, Base64.DEFAULT);

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.MediaColumns.DISPLAY_NAME, finalFileName);
                    values.put(MediaStore.MediaColumns.MIME_TYPE, "application/pdf");
                    values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                    values.put(MediaStore.MediaColumns.IS_PENDING, 1);

                    Uri uri = activity.getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                    if (uri != null) {
                        try (OutputStream os = activity.getContentResolver().openOutputStream(uri)) {
                            if (os != null) {
                                os.write(pdfBytes);
                                os.flush();
                            }
                        }
                        values.clear();
                        values.put(MediaStore.MediaColumns.IS_PENDING, 0);
                        activity.getContentResolver().update(uri, values, null, null);

                        activity.runOnUiThread(() -> Toast.makeText(activity, "PDF gespeichert in Downloads: " + finalFileName, Toast.LENGTH_LONG).show());
                        return true;
                    }
                }

                File downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                if (!downloadsDir.exists()) {
                    downloadsDir.mkdirs();
                }
                File destFile = new File(downloadsDir, finalFileName);
                try (FileOutputStream fos = new FileOutputStream(destFile)) {
                    fos.write(pdfBytes);
                    fos.flush();
                }
                MediaScannerConnection.scanFile(activity, new String[]{destFile.getAbsolutePath()}, new String[]{"application/pdf"}, null);

                activity.runOnUiThread(() -> Toast.makeText(activity, "PDF gespeichert: " + finalFileName, Toast.LENGTH_LONG).show());
                return true;
            } catch (Exception e) {
                Log.e(TAG, "Error saving PDF via native bridge: " + e.getMessage(), e);
                activity.runOnUiThread(() -> Toast.makeText(activity, "Fehler beim Speichern: " + e.getMessage(), Toast.LENGTH_SHORT).show());
                return false;
            }
        }

        @JavascriptInterface
        public boolean sharePdf(String fileName, String base64Data) {
            try {
                if (fileName == null || fileName.trim().isEmpty()) {
                    fileName = "document.pdf";
                }
                if (!fileName.toLowerCase().endsWith(".pdf")) {
                    fileName += ".pdf";
                }
                byte[] pdfBytes = Base64.decode(base64Data, Base64.DEFAULT);

                File cacheDir = activity.getCacheDir();
                File sharedDir = new File(cacheDir, "shared_pdfs");
                if (!sharedDir.exists()) {
                    sharedDir.mkdirs();
                }
                File file = new File(sharedDir, fileName);
                try (FileOutputStream fos = new FileOutputStream(file)) {
                    fos.write(pdfBytes);
                    fos.flush();
                }

                Uri contentUri = FileProvider.getUriForFile(
                        activity,
                        activity.getPackageName() + ".fileprovider",
                        file
                );

                Intent shareIntent = new Intent(Intent.ACTION_SEND);
                shareIntent.setType("application/pdf");
                shareIntent.putExtra(Intent.EXTRA_STREAM, contentUri);
                shareIntent.putExtra(Intent.EXTRA_SUBJECT, fileName);
                shareIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

                Intent chooser = Intent.createChooser(shareIntent, "PDF teilen / Share PDF");
                chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                activity.startActivity(chooser);
                return true;
            } catch (Exception e) {
                Log.e(TAG, "Error sharing PDF via native bridge: " + e.getMessage(), e);
                return false;
            }
        }

        @JavascriptInterface
        public boolean printPdf(final String documentName, final String base64Data) {
            try {
                final String docTitle = (documentName == null || documentName.trim().isEmpty())
                        ? "Document.pdf"
                        : documentName;
                final byte[] pdfBytes = Base64.decode(base64Data, Base64.DEFAULT);

                activity.runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        try {
                            PrintManager printManager = (PrintManager) activity.getSystemService(Context.PRINT_SERVICE);
                            if (printManager == null) {
                                Log.e(TAG, "PrintManager service not available");
                                return;
                            }

                            PrintDocumentAdapter adapter = new PrintDocumentAdapter() {
                                @Override
                                public void onLayout(PrintAttributes oldAttributes, PrintAttributes newAttributes,
                                                     CancellationSignal cancellationSignal,
                                                     LayoutResultCallback callback, Bundle extras) {
                                    if (cancellationSignal.isCanceled()) {
                                        callback.onLayoutCancelled();
                                        return;
                                    }
                                    PrintDocumentInfo info = new PrintDocumentInfo.Builder(docTitle)
                                            .setContentType(PrintDocumentInfo.CONTENT_TYPE_DOCUMENT)
                                            .setPageCount(PrintDocumentInfo.PAGE_COUNT_UNKNOWN)
                                            .build();
                                    callback.onLayoutFinished(info, true);
                                }

                                @Override
                                public void onWrite(PageRange[] pages, ParcelFileDescriptor destination,
                                                     CancellationSignal cancellationSignal,
                                                     WriteResultCallback callback) {
                                    try (OutputStream out = new FileOutputStream(destination.getFileDescriptor())) {
                                        out.write(pdfBytes);
                                        out.flush();
                                        callback.onWriteFinished(new PageRange[]{PageRange.ALL_PAGES});
                                    } catch (Exception e) {
                                        Log.e(TAG, "Error writing PDF to print spooler: " + e.getMessage(), e);
                                        callback.onWriteFailed(e.getMessage());
                                    }
                                }
                            };

                            PrintAttributes attributes = new PrintAttributes.Builder()
                                    .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                                    .build();

                            printManager.print(docTitle, adapter, attributes);
                        } catch (Exception e) {
                            Log.e(TAG, "Failed launching PrintManager: " + e.getMessage(), e);
                        }
                    }
                });
                return true;
            } catch (Exception e) {
                Log.e(TAG, "Error in printPdf: " + e.getMessage(), e);
                return false;
            }
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Expose NativePdfBridge to JavaScript
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().addJavascriptInterface(new NativePdfBridgeInterface(this), "NativePdfBridge");
        }

        handleIncomingIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIncomingIntent(intent);
    }

    private void handleIncomingIntent(Intent intent) {
        if (intent == null) return;

        String action = intent.getAction();
        Log.d(TAG, "Incoming intent action: " + action);

        if (Intent.ACTION_VIEW.equals(action) || Intent.ACTION_SEND.equals(action) || Intent.ACTION_EDIT.equals(action)) {
            Uri targetUri = null;

            // Check EXTRA_STREAM first (used by Share Sheet)
            if (intent.hasExtra(Intent.EXTRA_STREAM)) {
                try {
                    Bundle extras = intent.getExtras();
                    if (extras != null) {
                        Object extra = extras.get(Intent.EXTRA_STREAM);
                        if (extra instanceof Uri) {
                            targetUri = (Uri) extra;
                        } else if (extra instanceof ArrayList) {
                            ArrayList<?> list = (ArrayList<?>) extra;
                            if (!list.isEmpty() && list.get(0) instanceof Uri) {
                                targetUri = (Uri) list.get(0);
                            }
                        }
                    }
                } catch (Exception e) {
                    Log.w(TAG, "Error getting EXTRA_STREAM: " + e.getMessage());
                }
            }

            // Check intent.getData() (used by "Open with..." / VIEW)
            if (targetUri == null) {
                targetUri = intent.getData();
            }

            // Fallback to ClipData
            if (targetUri == null && intent.getClipData() != null && intent.getClipData().getItemCount() > 0) {
                targetUri = intent.getClipData().getItemAt(0).getUri();
            }

            if (targetUri != null) {
                readAndDeliverPdfUri(targetUri);
            }
        }
    }

    private void readAndDeliverPdfUri(Uri uri) {
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    Log.d(TAG, "Processing PDF URI: " + uri);

                    // Resolve display name
                    String fileName = "document.pdf";
                    try {
                        Cursor cursor = getContentResolver().query(uri, null, null, null, null);
                        if (cursor != null) {
                            if (cursor.moveToFirst()) {
                                int nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                                if (nameIndex >= 0) {
                                    String n = cursor.getString(nameIndex);
                                    if (n != null && !n.trim().isEmpty()) {
                                        fileName = n;
                                    }
                                }
                            }
                            cursor.close();
                        }
                    } catch (Exception e) {
                        Log.w(TAG, "Could not query display name: " + e.getMessage());
                    }

                    if ("document.pdf".equals(fileName) && uri.getLastPathSegment() != null) {
                        String last = uri.getLastPathSegment();
                        if (last.toLowerCase().endsWith(".pdf")) {
                            fileName = last;
                        } else {
                            fileName = last + ".pdf";
                        }
                    }

                    // Stream the content URI to a temporary file, not into Java heap.
                    String token = UUID.randomUUID().toString();
                    File staged = new File(getCacheDir(), "incoming-pdf-" + token + ".tmp");
                    try (InputStream input = getContentResolver().openInputStream(uri);
                         FileOutputStream output = new FileOutputStream(staged)) {
                        if (input == null) throw new java.io.IOException("ContentResolver returned no stream");
                        byte[] chunk = new byte[65536];
                        int n;
                        while ((n = input.read(chunk)) != -1) output.write(chunk, 0, n);
                    }

                    File previous = incomingPdfFile;
                    incomingPdfFile = staged;
                    incomingPdfToken = token;
                    if (previous != null) previous.delete();

                    JSONObject json = new JSONObject();
                    json.put("name", fileName);
                    json.put("token", token);
                    json.put("size", staged.length());
                    final String jsonStr = json.toString();

                    pendingPdfJson = jsonStr;

                    // Forward to WebView via javascript
                    if (getBridge() != null && getBridge().getWebView() != null) {
                        runOnUiThread(new Runnable() {
                            @Override
                            public void run() {
                                getBridge().getWebView().evaluateJavascript(
                                    "window.onNativePdfReceived && window.onNativePdfReceived(" + jsonStr + ");",
                                    null
                                );
                            }
                        });
                    }
                } catch (Exception e) {
                    Log.e(TAG, "Failed reading PDF from URI: " + e.getMessage(), e);
                }
            }
        }).start();
    }
}
