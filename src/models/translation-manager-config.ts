import { GahPluginConfig } from '@gah/shared';

export class TranslationManagerConfig extends GahPluginConfig {
  public searchGlobPattern: string;
  public destinationPath: string;
  public localeRegexPattern: string;
  public prefixRegexPattern: string;
  public mismatchConfig?: TranslationManagerMismatchGlobalConfig;
}

export type ReportType = 'warn' | 'error' | 'none';
export class TranslationManagerMismatchModuleConfig {
  public locales: string[];
  public reportLevel: ReportType;
}

export class TranslationManagerMismatchGlobalConfig {
  public reportFile?: string;
  public reportLevel?: ReportType;
  public mismatchConfigForModule?: {
    [moduleName: string]: TranslationManagerMismatchModuleConfig[];
  };
}
