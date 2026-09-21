import { useTranslation } from 'react-i18next';

import { CLOUDCLI_WORDMARK_FONT_FAMILY } from '@/shared/constants';

const loadingDotAnimationDelays = ['0s', '0.15s', '0.3s'];

/** Rendered by the auth module's ProtectedRoute while the initial auth status check is in flight. */
export default function AuthLoadingScreen() {
  const { t } = useTranslation('auth');
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background p-4">
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-36 left-1/2 h-[42rem] w-[56rem] -translate-x-1/2 rounded-full bg-primary/5 blur-3xl" />
      </div>

      <div className="relative text-center" role="status" aria-live="polite">
        <div className="mb-5 flex justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-card border border-border/60 shadow-lg p-2.5 ring-1 ring-foreground/5">
            <img src="/logo.svg" alt="Antigravity cli" className="h-11 w-11 object-contain select-none drop-shadow-sm" />
          </div>
        </div>

        <h1
          className="mb-4 text-2xl font-bold tracking-tight text-foreground"
          style={{ fontFamily: CLOUDCLI_WORDMARK_FONT_FAMILY }}
        >
          Antigravity cli
        </h1>
        <p className="sr-only">{t('misc.loadingState')}</p>
        <div aria-hidden className="flex items-center justify-center gap-2">
          {loadingDotAnimationDelays.map((delay) => (
            <div
              key={delay}
              className="h-2 w-2 animate-bounce rounded-full bg-primary"
              style={{ animationDelay: delay }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
