import React, { useState } from 'react';
import { X, AlertTriangle, Copy, Check, Terminal, Info, CheckCircle2 } from 'lucide-react';
import { AppError, APP_VERSION, formatAppErrorReport } from '../utils/appError';
import { getRuntimeVersionInfo } from '../utils/nativeBridge';

interface ErrorDiagnosticsModalProps {
  error?: AppError | null;
  extraLogs?: string[];
  onClose: () => void;
}

export const ErrorDiagnosticsModal: React.FC<ErrorDiagnosticsModalProps> = ({
  error = null,
  extraLogs = [],
  onClose,
}) => {
  const [copied, setCopied] = useState(false);
  const runtimeInfo = React.useMemo(() => getRuntimeVersionInfo(APP_VERSION), []);

  const fullReport = React.useMemo(() => {
    const base = formatAppErrorReport(error);
    if (extraLogs.length === 0) return base;
    return `${base}\n\n=== Native / System Logs ===\n${extraLogs.join('\n')}`;
  }, [error, extraLogs]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(fullReport);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for restricted webviews
      const textarea = document.createElement('textarea');
      textarea.value = fullReport;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand('copy');
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } finally {
        document.body.removeChild(textarea);
      }
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-labelledby="error-diagnostics-title"
    >
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden flex flex-col max-h-[85vh]">
        <div
          className={`px-5 py-4 border-b flex items-center justify-between gap-3 ${
            error ? 'bg-red-50/80 border-red-100' : 'bg-blue-50/80 border-blue-100'
          }`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                error ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'
              }`}
            >
              {error ? <AlertTriangle size={20} /> : <Info size={20} />}
            </div>
            <div className="min-w-0">
              <h2 id="error-diagnostics-title" className="text-base font-bold text-slate-900 truncate">
                {error ? error.title : 'PatricksPDF Info & Diagnostics'}
              </h2>
              <p
                className={`text-xs font-mono truncate ${
                  error ? 'text-red-700' : 'text-blue-700'
                }`}
              >
                {error ? error.code : `Version ${APP_VERSION}`}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-white/70 transition-colors cursor-pointer"
            aria-label="Close diagnostics"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4 text-sm">
          {/* Always-visible Build & APK Version Info Card */}
          <div className="bg-slate-50 rounded-xl p-3.5 border border-slate-200/80">
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
              App Info & Build Version
            </div>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
              <dt className="text-slate-500 font-medium">App Version:</dt>
              <dd className="text-slate-900 font-mono font-semibold">v{runtimeInfo.appVersion}</dd>

              <dt className="text-slate-500 font-medium">APK / Build Version:</dt>
              <dd className="text-slate-900 font-mono font-semibold truncate">
                {runtimeInfo.apkBuildVersion || `v${runtimeInfo.appVersion} (Web / PWA)`}
              </dd>

              <dt className="text-slate-500 font-medium">Runtime Environment:</dt>
              <dd className="text-slate-800 font-mono truncate">{runtimeInfo.runtimeEnvironment}</dd>
            </dl>
          </div>

          {error ? (
            <>
              <div>
                <p className="text-slate-700 leading-relaxed font-medium">{error.userMessage}</p>
                <p className="text-xs text-slate-400 mt-1">
                  Occurred on {new Date(error.timestamp).toLocaleString('en-US')}
                </p>
              </div>

              {error.context && Object.keys(error.context).length > 0 && (
                <div className="bg-slate-50 rounded-xl p-3 border border-slate-200/80">
                  <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                    Context Data
                  </div>
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                    {Object.entries(error.context).map(([k, v]) => (
                      <React.Fragment key={k}>
                        <dt className="text-slate-500 font-medium truncate">{k}:</dt>
                        <dd className="text-slate-800 font-mono truncate">{String(v ?? '–')}</dd>
                      </React.Fragment>
                    ))}
                  </dl>
                </div>
              )}

              <div>
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                  <Terminal size={13} />
                  <span>Technical Diagnostics & Stack Trace</span>
                </div>
                <pre className="bg-slate-900 text-slate-100 rounded-xl p-3.5 text-xs font-mono overflow-x-auto whitespace-pre-wrap break-words max-h-52 leading-relaxed">
                  {error.technicalDetails}
                </pre>
              </div>
            </>
          ) : (
            <div className="flex items-center gap-2.5 p-3.5 rounded-xl bg-emerald-50/80 border border-emerald-200/80 text-emerald-800 text-xs font-medium">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>No active runtime errors logged. All local PDF services are ready.</span>
            </div>
          )}

          {extraLogs.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                System / Share Log ({extraLogs.length})
              </div>
              <pre className="bg-slate-900 text-amber-200 rounded-xl p-3.5 text-xs font-mono overflow-x-auto whitespace-pre-wrap break-words max-h-40 leading-relaxed">
                {extraLogs.join('\n')}
              </pre>
            </div>
          )}
        </div>

        <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            {copied ? (
              <>
                <Check size={15} className="text-emerald-600" />
                <span className="text-emerald-700">Diagnostics Copied</span>
              </>
            ) : (
              <>
                <Copy size={15} />
                <span>Copy Diagnostic Report</span>
              </>
            )}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
