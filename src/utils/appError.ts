export type AppErrorCode =
  | 'PDF_LOAD_FAILED'
  | 'PDF_EXPORT_FAILED'
  | 'PDF_FORM_FLATTEN_WARNING'
  | 'PDF_PAGE_OPERATION_FAILED'
  | 'RECENT_DOC_LOAD_FAILED'
  | 'ANDROID_SHARE_FAILED'
  | 'SIGNATURE_PROCESS_FAILED'
  | 'STORAGE_ERROR'
  | 'UNKNOWN_ERROR';

export interface AppError {
  id: string;
  code: AppErrorCode;
  title: string;
  userMessage: string;
  technicalDetails: string;
  timestamp: string;
  recoverable: boolean;
  context?: Record<string, string | number | boolean | null | undefined>;
}

export function createAppError(
  code: AppErrorCode,
  title: string,
  userMessage: string,
  error?: unknown,
  context?: Record<string, string | number | boolean | null | undefined>,
  recoverable = true
): AppError {
  let detailStr = '';
  if (error instanceof Error) {
    detailStr = `${error.name}: ${error.message}${error.stack ? `\n${error.stack}` : ''}`;
  } else if (typeof error === 'string') {
    detailStr = error;
  } else if (error !== undefined && error !== null) {
    try {
      detailStr = JSON.stringify(error, null, 2);
    } catch {
      detailStr = String(error);
    }
  }

  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    code,
    title,
    userMessage,
    technicalDetails: detailStr || 'Keine weiteren technischen Details verfügbar.',
    timestamp: new Date().toISOString(),
    recoverable,
    context,
  };
}

import { getRuntimeVersionInfo } from './nativeBridge';

export const APP_VERSION = '2.3.0';

export function formatAppErrorReport(err?: AppError | null): string {
  const runtimeInfo = getRuntimeVersionInfo(APP_VERSION);
  const buildLabel = runtimeInfo.apkBuildVersion
    ? `${APP_VERSION} / APK ${runtimeInfo.apkBuildVersion}`
    : `${APP_VERSION} (Web / PWA)`;

  if (!err) {
    return [
      `=== PatricksPDF v${APP_VERSION} Info & Diagnose ===`,
      `Zeitpunkt: ${new Date().toISOString()}`,
      `Build-Version: ${buildLabel}`,
      `Umgebung: ${runtimeInfo.runtimeEnvironment}`,
      `Status: Keine aktiven Laufzeitfehler protokolliert.`,
    ].join('\n');
  }

  const lines = [
    `=== PatricksPDF v${APP_VERSION} Fehlerdiagnose ===`,
    `Zeitpunkt: ${err.timestamp}`,
    `Build-Version: ${buildLabel}`,
    `Umgebung: ${runtimeInfo.runtimeEnvironment}`,
    `Code: ${err.code}`,
    `Titel: ${err.title}`,
    `Meldung: ${err.userMessage}`,
  ];
  if (err.context && Object.keys(err.context).length > 0) {
    lines.push(`Kontext: ${JSON.stringify(err.context)}`);
  }
  lines.push(`Details:\n${err.technicalDetails}`);
  return lines.join('\n');
}
