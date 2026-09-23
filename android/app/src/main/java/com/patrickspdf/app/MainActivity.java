package com.patrickspdf.app;

import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import android.print.PageRange;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintDocumentInfo;
import android.print.PrintManager;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.util.Log;
import android.webkit.JavascriptInterface;

import androidx.core.content.FileProvider;
import com.getcapacitor.BridgeActivity;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;

public class MainActivity extends BridgeActivity {
    private static final String TAG = "PatricksPDF_Native";
    private volatile String pendingPdfJson = null;

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
        public boolean isNativeBridge() {
            return true;
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

                    // Read bytes directly from ContentResolver with granted URI permissions
                    InputStream is = getContentResolver().openInputStream(uri);
                    if (is == null) {
                        Log.e(TAG, "ContentResolver returned null InputStream for " + uri);
                        return;
                    }

                    ByteArrayOutputStream buffer = new ByteArrayOutputStream();
                    byte[] chunk = new byte[32768];
                    int nRead;
                    while ((nRead = is.read(chunk, 0, chunk.length)) != -1) {
                        buffer.write(chunk, 0, nRead);
                    }
                    buffer.flush();
                    is.close();

                    byte[] pdfBytes = buffer.toByteArray();
                    Log.d(TAG, "Read " + pdfBytes.length + " bytes for " + fileName);

                    String base64 = Base64.encodeToString(pdfBytes, Base64.NO_WRAP);

                    JSONObject json = new JSONObject();
                    json.put("name", fileName);
                    json.put("base64", base64);
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
