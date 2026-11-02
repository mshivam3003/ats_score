// Shim to expose docx named exports under NodeNext module resolution.
// The package exports them correctly at runtime (tsx); this shim fixes the
// TypeScript false-positive TS2305 caused by NodeNext's strict exports-map
// walking not finding types for re-exported sub-paths in docx v8.
declare module 'docx' {
  export { File as Document } from 'docx/build/file/file';
  export class Packer {
    static toBuffer(file: InstanceType<typeof import('docx/build/file/file').File>): Promise<Buffer>;
    static toString(file: InstanceType<typeof import('docx/build/file/file').File>): Promise<string>;
    static toBase64String(file: InstanceType<typeof import('docx/build/file/file').File>): Promise<string>;
    static toBlob(file: InstanceType<typeof import('docx/build/file/file').File>): Promise<Blob>;
  }
  export class Paragraph {
    constructor(options: Record<string, any>);
  }
  export class TextRun {
    constructor(options: Record<string, any>);
  }
  export enum HeadingLevel {
    HEADING_1 = 'Heading1',
    HEADING_2 = 'Heading2',
    HEADING_3 = 'Heading3',
  }
  export enum AlignmentType {
    LEFT = 'left',
    CENTER = 'center',
    RIGHT = 'right',
    JUSTIFY = 'both',
  }
  export const Document: new (options: Record<string, any>) => any;
}

