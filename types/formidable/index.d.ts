declare module 'formidable' {
  export interface File {
    filepath?: string;
    originalFilename?: string;
    mimetype?: string;
    size?: number;
  }
  export interface Files {
    [field: string]: File | File[];
  }
  export interface Fields {
    [field: string]: any;
  }
  export interface Formidable {
    (options?: any): {
      parse: (req: any, callback: (err: any, fields: Fields, files: Files) => void) => void;
    };
  }
  const f: Formidable;
  export default f;
}
