export class TranslationCollection {
  public locale: string;
  public translations: any;
  public path?: string;
  public prefix?: string;

  constructor() {
    this.translations = {};
  }
}
