import mammoth from 'mammoth';
import pdfParse from 'pdf-parse';

export async function extractTextFromBuffer(
  buffer: Buffer,
  filename: string,
  mimetype?: string
): Promise<string> {
  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase();

  if (ext === '.pdf' || mimetype === 'application/pdf') {
    const data = await pdfParse(buffer);
    return data.text ? data.text.trim() : '';
  }

  if (
    ext === '.docx' ||
    mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    const result = await mammoth.extractRawText({ buffer });
    return result.value ? result.value.trim() : '';
  }

  if (ext === '.txt' || mimetype?.startsWith('text/')) {
    return buffer.toString('utf-8').trim();
  }

  // Fallback string conversion
  return buffer.toString('utf-8').trim();
}
