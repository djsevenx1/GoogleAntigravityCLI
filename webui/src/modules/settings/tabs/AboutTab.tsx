import { Cpu, ExternalLink, Globe, Sparkles, Terminal } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { CLOUDCLI_WORDMARK_FONT_FAMILY, APP_VERSION } from '@/shared/constants';

const ANTIGRAVITY_OFFICIAL_URL = 'https://antigravity.google';

/** Rendered by Settings for the "about" tab, showing official Google Antigravity info, features, and version status. */
export default function AboutTab() {
  const { t } = useTranslation('settings');

  return (
    <div className="space-y-6">
      {/* Logo + Name + Version */}
      <div className="flex items-start gap-4">
        <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl bg-card border border-border/60 shadow-md p-2.5 ring-1 ring-foreground/5">
          <img
            src="/logo.svg"
            alt="Antigravity"
            className="h-full w-full object-contain select-none drop-shadow-sm"
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <span
              className="text-lg font-bold text-foreground tracking-tight"
              style={{ fontFamily: CLOUDCLI_WORDMARK_FONT_FAMILY }}
            >
              Antigravity cli
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              v{APP_VERSION} ({t('about.currentStatus')})
            </span>
          </div>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            {t('about.tagline')}
          </p>
        </div>
      </div>

      {/* Official Website Button */}
      <div>
        <a
          href={ANTIGRAVITY_OFFICIAL_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-xl border border-primary/20 bg-primary/10 px-4 py-2.5 text-sm font-medium text-primary transition-all hover:bg-primary/20 hover:border-primary/30 shadow-sm"
        >
          <Globe className="h-4 w-4" />
          <span>{t('about.officialSite')} (antigravity.google)</span>
          <ExternalLink className="h-3.5 w-3.5 opacity-70" />
        </a>
      </div>

      {/* Core Features */}
      <div className="space-y-3 pt-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t('about.coreFeaturesTitle')}
        </h3>

        <div className="grid gap-3">
          <div className="flex items-start gap-3.5 rounded-xl border border-border/60 bg-card/60 p-4 transition-colors hover:bg-card">
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-blue-500/10 text-blue-500 dark:text-blue-400">
              <Cpu className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h4 className="text-sm font-medium text-foreground">
                {t('about.featureEngineTitle')}
              </h4>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {t('about.featureEngineDescription')}
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3.5 rounded-xl border border-border/60 bg-card/60 p-4 transition-colors hover:bg-card">
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-purple-500/10 text-purple-500 dark:text-purple-400">
              <Sparkles className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h4 className="text-sm font-medium text-foreground">
                {t('about.featureQuotaTitle')}
              </h4>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {t('about.featureQuotaDescription')}
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3.5 rounded-xl border border-border/60 bg-card/60 p-4 transition-colors hover:bg-card">
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500 dark:text-emerald-400">
              <Terminal className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h4 className="text-sm font-medium text-foreground">
                {t('about.featureWorkflowTitle')}
              </h4>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {t('about.featureWorkflowDescription')}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* License / Footer */}
      <div className="border-t border-border/50 pt-4 flex items-center justify-between text-xs text-muted-foreground/60">
        <span>{t('about.licensed')}</span>
        <span>Google DeepMind • Advanced Agentic Coding</span>
      </div>
    </div>
  );
}
