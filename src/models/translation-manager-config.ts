import { GahPluginConfig } from '@gah/shared';

export class TranslationManagerConfig extends GahPluginConfig {
  public searchGlobPattern: string;
  public destinationPath: string;
  public localeRegexPattern: string;
  public prefixRegexPattern: string;
  public translationMismatchReport: 'error' | 'warn' | 'off';
}
