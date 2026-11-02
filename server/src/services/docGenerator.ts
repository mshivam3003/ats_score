import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from 'docx';
import PDFDocument from 'pdfkit';

export async function createDocxBuffer(text: string): Promise<Buffer> {
  const lines = text.split('\n');
  const paragraphs: Paragraph[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      paragraphs.push(new Paragraph({ text: '' }));
      continue;
    }

    // Main headings (e.g. # SUMMARY or SUMMARY)
    if (line.startsWith('# ') || (line === line.toUpperCase() && line.length < 35 && !line.includes(':'))) {
      const headingText = line.replace(/^#+\s*/, '');
      paragraphs.push(
        new Paragraph({
          text: headingText,
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 240, after: 120 },
        })
      );
      continue;
    }

    // Subheadings
    if (line.startsWith('## ') || line.startsWith('### ')) {
      const headingText = line.replace(/^#+\s*/, '');
      paragraphs.push(
        new Paragraph({
          text: headingText,
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 180, after: 80 },
        })
      );
      continue;
    }

    // Bullet points
    if (line.startsWith('- ') || line.startsWith('* ') || line.startsWith('• ')) {
      const bulletContent = line.replace(/^[-*•]\s*/, '');
      paragraphs.push(
        new Paragraph({
          children: [new TextRun({ text: bulletContent, font: 'Calibri', size: 22 })],
          bullet: { level: 0 },
          spacing: { after: 60 },
        })
      );
      continue;
    }

    // Normal text
    paragraphs.push(
      new Paragraph({
        children: [new TextRun({ text: line, font: 'Calibri', size: 22 })],
        spacing: { after: 80 },
      })
    );
  }

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 720, // 0.5 inch
              bottom: 720,
              left: 720,
              right: 720,
            },
          },
        },
        children: paragraphs,
      },
    ],
  });

  return await Packer.toBuffer(doc);
}

export function createPdfBuffer(text: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 50,
      info: {
        Title: 'Optimized Resume',
        Author: 'ResumeRise AI',
      },
    });

    const buffers: Buffer[] = [];
    doc.on('data', (chunk) => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', (err) => reject(err));

    const lines = text.split('\n');

    for (const rawLine of lines) {
      const line = rawLine.trim();

      if (!line) {
        doc.moveDown(0.4);
        continue;
      }

      if (line.startsWith('# ') || (line === line.toUpperCase() && line.length < 35 && !line.includes(':'))) {
        const hText = line.replace(/^#+\s*/, '');
        doc.moveDown(0.6);
        doc.font('Helvetica-Bold').fontSize(14).fillColor('#1e293b').text(hText);
        doc.strokeColor('#cbd5e1').lineWidth(0.5).moveTo(doc.x, doc.y).lineTo(545, doc.y).stroke();
        doc.moveDown(0.3);
        continue;
      }

      if (line.startsWith('## ') || line.startsWith('### ')) {
        const hText = line.replace(/^#+\s*/, '');
        doc.moveDown(0.4);
        doc.font('Helvetica-Bold').fontSize(11).fillColor('#334155').text(hText);
        doc.moveDown(0.2);
        continue;
      }

      if (line.startsWith('- ') || line.startsWith('* ') || line.startsWith('• ')) {
        const bText = line.replace(/^[-*•]\s*/, '');
        doc.font('Helvetica').fontSize(10).fillColor('#1e293b').text(`•  ${bText}`, {
          indent: 10,
          lineGap: 2,
        });
        continue;
      }

      doc.font('Helvetica').fontSize(10).fillColor('#1e293b').text(line, {
        lineGap: 2,
      });
    }

    doc.end();
  });
}
