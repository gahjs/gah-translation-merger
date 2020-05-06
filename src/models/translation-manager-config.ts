import { GahPluginConfig } from '@awdware/gah-shared';

export class TranslationManagerConfig extends GahPluginConfig {
  public searchGlobPattern: string;
  public destinationPath: string;
}
