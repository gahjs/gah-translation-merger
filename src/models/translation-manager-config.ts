import { GahPluginConfig } from '@awdware/gah';

export class TranslationManagerConfig extends GahPluginConfig {
  public searchGlobPattern: string;
  public destinationPath: string;
}
