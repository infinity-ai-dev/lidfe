import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'npm:pdf-lib@1.17.1';
import QRCode from 'npm:qrcode@1.5.3';

const A4_PAGE_SIZE: [number, number] = [595.28, 841.89];
const PAGE_MARGIN = 20;
const CONTENT_WIDTH = A4_PAGE_SIZE[0] - PAGE_MARGIN * 2;
const FOOTER_TOP = 96;
const EXAM_DOWNLOAD_QR_BLOCK_BOTTOM = 118;
const EXAM_DOWNLOAD_QR_BLOCK_HEIGHT = 242;
const SIGNATURE_QR_RESERVED_WIDTH = 122;
const DOCTOR_NAME_COLOR = rgb(0.4, 0.55, 0.23);
const BORDER_COLOR = rgb(0.18, 0.18, 0.18);
const MUTED_COLOR = rgb(0.28, 0.28, 0.28);
const BADGE_BLUE = rgb(0.08, 0.14, 0.34);

interface BaseTemplateArgs {
  nomePaciente?: string;
  cpfPaciente?: string;
  emailPaciente?: string;
  nomeMedico?: string;
  crmMedico?: string;
  rqeMedico?: string;
  especialidadeMedico?: string;
  cpfMedico?: string;
  enderecoMedico?: string;
  telefoneMedico?: string;
  dataEmissao?: string;
  clinicaNome?: string;
}

interface ExamTemplateArgs extends BaseTemplateArgs {
  tituloExame?: string;
  descricaoExame?: string;
}

interface GeneralGuideArgs extends BaseTemplateArgs {
  linhasExames?: string[];
}

interface PrescriptionTemplateArgs extends BaseTemplateArgs {
  titulo?: string;
  medicamentos?: string[];
  observacoes?: string;
  dataValidade?: string;
}

type PageFonts = {
  regular: PDFFont;
  bold: PDFFont;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const parseDateInput = (raw?: string): Date | null => {
  if (!raw) return null;

  const normalized = raw.trim();
  if (!normalized) return null;

  const ptBrMatch = normalized.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (ptBrMatch) {
    const [, day, month, year] = ptBrMatch;
    const parsed = new Date(Number(year), Number(month) - 1, Number(day));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatPtBrDate = (raw?: string): string => {
  if (!raw) return new Date().toLocaleDateString('pt-BR');
  const parsed = parseDateInput(raw);
  if (!parsed) return raw;
  return parsed.toLocaleDateString('pt-BR');
};

const addDaysToPtBrDate = (raw: string | undefined, days: number): string => {
  const date = parseDateInput(raw) || new Date();
  date.setDate(date.getDate() + days);
  return date.toLocaleDateString('pt-BR');
};

const sanitizeDoctorDisplayName = (value?: string): string => {
  const name = (value || Deno.env.get('MEDICO_NOME') || 'Médico Responsável').trim();
  return /^dr/i.test(name) ? name : `Dr(a). ${name}`;
};

const buildClinicName = (value?: string): string => {
  return value?.trim() || Deno.env.get('CLINICA_NOME') || 'LIDFE';
};

export const wrapText = (
  text: string,
  maxWidth: number,
  font: PDFFont,
  fontSize: number
): string[] => {
  if (!text) return [];
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];

  const words = normalized.split(' ');
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(next, fontSize) <= maxWidth) {
      current = next;
      continue;
    }

    if (current) {
      lines.push(current);
      current = word;
      continue;
    }

    let fragment = '';
    for (const char of word) {
      const nextFragment = `${fragment}${char}`;
      if (font.widthOfTextAtSize(nextFragment, fontSize) <= maxWidth) {
        fragment = nextFragment;
      } else {
        if (fragment) lines.push(fragment);
        fragment = char;
      }
    }
    current = fragment;
  }

  if (current) lines.push(current);
  return lines;
};

export const createBlankTemplateBytes = async (): Promise<Uint8Array> => {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.addPage(A4_PAGE_SIZE);
  return await pdfDoc.save();
};

const loadFreshDocument = async (_templateBytes?: Uint8Array | null): Promise<PDFDocument> => {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.addPage(A4_PAGE_SIZE);
  return pdfDoc;
};

const getFonts = async (pdfDoc: PDFDocument): Promise<PageFonts> => ({
  regular: await pdfDoc.embedFont(StandardFonts.Helvetica),
  bold: await pdfDoc.embedFont(StandardFonts.HelveticaBold),
});

const clearPage = (page: PDFPage) => {
  const { width, height } = page.getSize();
  page.drawRectangle({
    x: 0,
    y: 0,
    width,
    height,
    color: rgb(1, 1, 1),
  });
};

const drawCenteredText = (
  page: PDFPage,
  text: string,
  centerX: number,
  y: number,
  font: PDFFont,
  size: number,
  color = BORDER_COLOR
) => {
  const width = font.widthOfTextAtSize(text, size);
  page.drawText(text, {
    x: centerX - width / 2,
    y,
    size,
    font,
    color,
  });
};

const drawRightAlignedText = (
  page: PDFPage,
  text: string,
  rightX: number,
  y: number,
  font: PDFFont,
  size: number,
  color = BORDER_COLOR
) => {
  const width = font.widthOfTextAtSize(text, size);
  page.drawText(text, {
    x: rightX - width,
    y,
    size,
    font,
    color,
  });
};

const drawHorizontalRule = (page: PDFPage, y: number, thickness = 0.8) => {
  page.drawLine({
    start: { x: PAGE_MARGIN, y },
    end: { x: A4_PAGE_SIZE[0] - PAGE_MARGIN, y },
    thickness,
    color: BORDER_COLOR,
  });
};

const drawLabelValue = (
  page: PDFPage,
  label: string,
  value: string,
  x: number,
  y: number,
  fonts: PageFonts,
  valueColor = BORDER_COLOR
) => {
  page.drawText(label, {
    x,
    y,
    size: 9.4,
    font: fonts.bold,
    color: BORDER_COLOR,
  });

  const labelWidth = fonts.bold.widthOfTextAtSize(label, 9.4);
  page.drawText(value || '-', {
    x: x + labelWidth + 6,
    y,
    size: 9.4,
    font: fonts.regular,
    color: valueColor,
  });
};

const drawDottedLeader = (
  page: PDFPage,
  startX: number,
  endX: number,
  y: number,
  dotSpacing = 4
) => {
  for (let x = startX; x <= endX; x += dotSpacing) {
    page.drawCircle({
      x,
      y,
      size: 0.58,
      color: BORDER_COLOR,
    });
  }
};

const drawDocumentTitleBox = (
  page: PDFPage,
  title: string,
  fonts: PageFonts,
  options?: { topRightNotes?: string[] }
) => {
  const top = A4_PAGE_SIZE[1] - 26;
  const height = 20;
  page.drawRectangle({
    x: PAGE_MARGIN,
    y: top - height,
    width: CONTENT_WIDTH,
    height,
    borderColor: BORDER_COLOR,
    borderWidth: 0.8,
  });

  drawCenteredText(page, title, A4_PAGE_SIZE[0] / 2, top - 13, fonts.bold, 10.2);

  if (options?.topRightNotes?.length) {
    let noteY = top + 4;
    for (const note of options.topRightNotes) {
      drawRightAlignedText(page, note, A4_PAGE_SIZE[0] - PAGE_MARGIN, noteY, fonts.bold, 6.2, MUTED_COLOR);
      noteY -= 8;
    }
  }

  return top - height - 18;
};

const drawMedicalHeaderBlock = (
  page: PDFPage,
  args: BaseTemplateArgs,
  fonts: PageFonts,
  dataEmissao: string
) => {
  const clinicName = buildClinicName(args.clinicaNome);
  const doctorName = sanitizeDoctorDisplayName(args.nomeMedico);
  const specialityLine = [args.especialidadeMedico || '', args.rqeMedico || ''].filter(Boolean).join(' - ');
  let y = A4_PAGE_SIZE[1] - 88;

  drawLabelValue(page, 'Clínica', clinicName, PAGE_MARGIN + 4, y, fonts);
  drawLabelValue(page, 'Data de emissão:', dataEmissao, 360, y, fonts);
  y -= 18;

  drawLabelValue(page, 'Endereço:', args.enderecoMedico || Deno.env.get('MEDICO_ENDERECO') || '-', PAGE_MARGIN + 4, y, fonts);
  y -= 18;

  drawLabelValue(page, 'Telefone:', args.telefoneMedico || Deno.env.get('MEDICO_TELEFONE') || '-', PAGE_MARGIN + 4, y, fonts);
  y -= 18;

  drawLabelValue(page, '', doctorName, PAGE_MARGIN + 4, y, fonts, DOCTOR_NAME_COLOR);
  drawLabelValue(page, 'CRM:', args.crmMedico || '-', 395, y, fonts);
  y -= 18;

  page.drawText(specialityLine || 'Medicina', {
    x: PAGE_MARGIN + 4,
    y,
    size: 9,
    font: fonts.regular,
    color: MUTED_COLOR,
  });

  y -= 14;
  drawHorizontalRule(page, y);
  return y - 18;
};

const drawQualifiedSignatureBadge = (page: PDFPage, x: number, y: number, fonts: PageFonts) => {
  const width = 108;
  const height = 42;

  page.drawRectangle({
    x,
    y,
    width,
    height,
    color: BADGE_BLUE,
  });

  page.drawText('ASSINATURA ELETRONICA', {
    x: x + 8,
    y: y + 29,
    size: 5.7,
    font: fonts.bold,
    color: rgb(1, 1, 1),
  });
  page.drawText('QUALIFICADA', {
    x: x + 18,
    y: y + 18,
    size: 8,
    font: fonts.bold,
    color: rgb(1, 1, 1),
  });
  page.drawText('ICP', {
    x: x + 12,
    y: y + 8,
    size: 11,
    font: fonts.bold,
    color: rgb(1, 1, 1),
  });
  page.drawText('Brasil', {
    x: x + 36,
    y: y + 10,
    size: 7,
    font: fonts.bold,
    color: rgb(1, 1, 1),
  });
};

const drawSignatureFooter = (
  page: PDFPage,
  fonts: PageFonts,
  options: { doctorName: string; documentLabel: string }
) => {
  const footerY = 22;
  const badgeX = PAGE_MARGIN;
  const badgeY = footerY;
  const textX = badgeX + 116;
  const textWidth = A4_PAGE_SIZE[0] - textX - SIGNATURE_QR_RESERVED_WIDTH - 16;

  drawQualifiedSignatureBadge(page, badgeX, badgeY, fonts);

  const legalText =
    `${options.documentLabel} assinado digitalmente por ${options.doctorName}. ` +
    'Conforme MP no 2.200-2/2001 e resoluções vigentes do CFM. ' +
    'A autenticidade pode ser validada pelo QR code no canto inferior direito ou em https://validar.iti.gov.br.';

  const lines = wrapText(legalText, textWidth, fonts.regular, 5.9).slice(0, 5);
  let y = badgeY + 28;
  for (const line of lines) {
    page.drawText(line, {
      x: textX,
      y,
      size: 5.9,
      font: fonts.regular,
      color: MUTED_COLOR,
    });
    y -= 7;
  }
};

const drawPrescriptionBoxes = (page: PDFPage, fonts: PageFonts) => {
  const bottom = 92;
  const height = 90;
  const leftWidth = 240;
  const gap = 10;
  const rightWidth = CONTENT_WIDTH - leftWidth - gap;

  page.drawRectangle({
    x: PAGE_MARGIN,
    y: bottom,
    width: leftWidth,
    height,
    borderColor: BORDER_COLOR,
    borderWidth: 0.8,
  });

  page.drawRectangle({
    x: PAGE_MARGIN + leftWidth + gap,
    y: bottom,
    width: rightWidth,
    height,
    borderColor: BORDER_COLOR,
    borderWidth: 0.8,
  });

  page.drawText('IDENTIFICAÇÃO DO COMPRADOR', {
    x: PAGE_MARGIN + 6,
    y: bottom + height - 14,
    size: 8.4,
    font: fonts.bold,
    color: BORDER_COLOR,
  });

  page.drawText('IDENTIFICAÇÃO DO FORNECEDOR', {
    x: PAGE_MARGIN + leftWidth + gap + 10,
    y: bottom + height - 14,
    size: 8.4,
    font: fonts.bold,
    color: BORDER_COLOR,
  });

  const leftLabels = ['Nome:', 'RG:', 'Telefone:', 'Endereço:', 'Cidade/UF:'];
  let y = bottom + height - 30;
  for (const label of leftLabels) {
    page.drawText(label, {
      x: PAGE_MARGIN + 6,
      y,
      size: 7.8,
      font: fonts.bold,
      color: BORDER_COLOR,
    });
    y -= 16;
  }

  const rightX = PAGE_MARGIN + leftWidth + gap + 14;
  page.drawLine({
    start: { x: rightX, y: bottom + 40 },
    end: { x: rightX + rightWidth - 28, y: bottom + 40 },
    thickness: 0.7,
    color: BORDER_COLOR,
  });
  page.drawLine({
    start: { x: rightX, y: bottom + 16 },
    end: { x: rightX + rightWidth - 28, y: bottom + 16 },
    thickness: 0.7,
    color: BORDER_COLOR,
  });
  drawCenteredText(page, 'Data', rightX + (rightWidth - 28) / 2, bottom + 26, fonts.bold, 7.6);
  drawCenteredText(page, 'Assinatura do Farmacêutico', rightX + (rightWidth - 28) / 2, bottom + 2, fonts.bold, 7.6);
};

const parsePrescriptionItem = (line: string, index: number) => {
  const raw = (line || '').trim();
  if (!raw) {
    return {
      index,
      title: `Item ${index}`,
      instruction: '',
      quantity: '',
    };
  }

  const segments = raw.split(/\s+-\s+/);
  const title = segments.shift() || `Item ${index}`;
  let quantity = '';
  const instructions: string[] = [];

  for (const segment of segments) {
    if (/^\d+\s*(cp|cpr|caps|cx|fr|ml|mg|g|amp|ampola)/i.test(segment)) {
      quantity = segment;
      continue;
    }
    instructions.push(segment);
  }

  return {
    index,
    title,
    instruction: instructions.join(' - '),
    quantity,
  };
};

const parseGeneralGuideEntries = (linhasExames: string[] = []) => {
  const entries: Array<{ title: string; description: string }> = [];
  let current: { title: string; description: string } | null = null;

  for (const rawLine of linhasExames) {
    const line = (rawLine || '').trim();
    if (!line) continue;

    const numberedMatch = line.match(/^\d+\.\s*(.+)$/);
    if (numberedMatch) {
      if (current) entries.push(current);
      current = {
        title: numberedMatch[1].trim(),
        description: '',
      };
      continue;
    }

    if (!current) {
      current = { title: line, description: '' };
      continue;
    }

    current.description = current.description ? `${current.description} ${line}` : line;
  }

  if (current) entries.push(current);
  return entries;
};

const drawListEntry = (
  page: PDFPage,
  fonts: PageFonts,
  options: {
    index: number;
    title: string;
    subtitle?: string;
    quantity?: string;
    x?: number;
    y: number;
    width: number;
  }
) => {
  const x = options.x ?? PAGE_MARGIN + 14;
  const indexText = `${options.index}`;
  page.drawText(indexText, {
    x,
    y: options.y,
    size: 9,
    font: fonts.bold,
    color: BORDER_COLOR,
  });

  const titleX = x + 18;
  const quantityWidth = options.quantity ? fonts.regular.widthOfTextAtSize(options.quantity, 9) : 0;
  const titleMaxWidth = options.width - 38 - quantityWidth - (options.quantity ? 28 : 0);
  const titleLines = wrapText(options.title, titleMaxWidth, fonts.bold, 10.2);
  let titleY = options.y;
  for (const line of titleLines.slice(0, 2)) {
    page.drawText(line, {
      x: titleX,
      y: titleY,
      size: 10.2,
      font: fonts.bold,
      color: BORDER_COLOR,
    });
    titleY -= 12;
  }

  if (options.quantity && titleLines.length === 1) {
    const titleLine = titleLines[0] || options.title;
    const quantityX = x + options.width - quantityWidth;
    const dotsStart = titleX + fonts.bold.widthOfTextAtSize(titleLine, 10.2) + 8;
    const dotsEnd = quantityX - 8;
    if (dotsEnd > dotsStart) {
      drawDottedLeader(page, dotsStart, dotsEnd, options.y + 4);
    }
    page.drawText(options.quantity, {
      x: quantityX,
      y: options.y,
      size: 9,
      font: fonts.regular,
      color: BORDER_COLOR,
    });
  }

  let consumedHeight = Math.max(16, titleLines.slice(0, 2).length * 12 + 2);
  if (options.subtitle) {
    const subtitleLines = wrapText(options.subtitle, options.width - 18, fonts.regular, 9.2);
    let subtitleY = options.y - (titleLines.slice(0, 2).length > 1 ? 27 : 15);
    for (const line of subtitleLines.slice(0, 4)) {
      page.drawText(line, {
        x: titleX,
        y: subtitleY,
        size: 9.2,
        font: fonts.regular,
        color: MUTED_COLOR,
      });
      subtitleY -= 12;
      consumedHeight += 12;
    }
  }

  return consumedHeight;
};

const drawExamGuideBase = async (
  args: BaseTemplateArgs,
  title: string,
  documentSubtype: 'single' | 'general',
  entries: Array<{ title: string; description: string }>
) => {
  const pdfDoc = await loadFreshDocument();
  const fonts = await getFonts(pdfDoc);
  const page = pdfDoc.getPages()[0];
  clearPage(page);

  const dataEmissao = formatPtBrDate(args.dataEmissao);
  drawDocumentTitleBox(page, title, fonts);
  let y = drawMedicalHeaderBlock(page, args, fonts, dataEmissao);

  drawLabelValue(
    page,
    'Paciente:',
    [args.cpfPaciente, args.nomePaciente].filter(Boolean).join(' - ') || args.nomePaciente || 'Paciente',
    PAGE_MARGIN + 4,
    y,
    fonts
  );
  y -= 14;
  drawHorizontalRule(page, y);
  y -= 20;

  const sectionTitle = documentSubtype === 'general' ? 'EXAMES SOLICITADOS' : 'EXAME SOLICITADO';
  page.drawText(sectionTitle, {
    x: PAGE_MARGIN + 42,
    y,
    size: 10.4,
    font: fonts.bold,
    color: BORDER_COLOR,
  });
  y -= 24;

  const listWidth = CONTENT_WIDTH - 54;
  const minY = FOOTER_TOP + EXAM_DOWNLOAD_QR_BLOCK_HEIGHT + 24;
  entries.forEach((entry, index) => {
    if (y <= minY) return;
    const consumed = drawListEntry(page, fonts, {
      index: index + 1,
      title: entry.title,
      subtitle: entry.description,
      y,
      width: listWidth,
    });
    y -= consumed + 8;
  });

  const infoText = documentSubtype === 'general'
    ? 'Guia consolidada para apresentação em laboratório ou farmácia conveniada.'
    : 'Documento válido para solicitação do exame informado.';

  const infoLines = wrapText(infoText, 260, fonts.regular, 8.6);
  let infoY = FOOTER_TOP + EXAM_DOWNLOAD_QR_BLOCK_HEIGHT + 4;
  for (const line of infoLines) {
    page.drawText(line, {
      x: PAGE_MARGIN + 42,
      y: infoY,
      size: 8.6,
      font: fonts.regular,
      color: MUTED_COLOR,
    });
    infoY -= 11;
  }

  drawSignatureFooter(page, fonts, {
    doctorName: args.nomeMedico || Deno.env.get('MEDICO_NOME') || 'Médico Responsável',
    documentLabel: 'Guia de exame',
  });

  return await pdfDoc.save();
};

export const preencherTemplate = async (
  templateBytes: Uint8Array | null,
  args: ExamTemplateArgs
): Promise<Uint8Array> => {
  const description = args.descricaoExame || '';
  const entries = [{
    title: args.tituloExame || 'Exame Laboratorial',
    description,
  }];

  return await drawExamGuideBase(args, 'Guia de Exames', 'single', entries);
};

export const preencherTemplateGuiaGeral = async (
  templateBytes: Uint8Array | null,
  args: GeneralGuideArgs
): Promise<Uint8Array> => {
  const parsedEntries = parseGeneralGuideEntries(args.linhasExames);
  const entries = parsedEntries.length
    ? parsedEntries
    : [{ title: 'Exame Laboratorial', description: '' }];

  return await drawExamGuideBase(args, 'Guia de Exames', 'general', entries);
};

export const preencherTemplatePrescricao = async (
  templateBytes: Uint8Array | null,
  args: PrescriptionTemplateArgs
): Promise<Uint8Array> => {
  const pdfDoc = await loadFreshDocument(templateBytes);
  const fonts = await getFonts(pdfDoc);
  const page = pdfDoc.getPages()[0];
  clearPage(page);

  const dataEmissao = formatPtBrDate(args.dataEmissao);
  const dataValidade = args.dataValidade || addDaysToPtBrDate(args.dataEmissao, 10);
  drawDocumentTitleBox(page, args.titulo || 'Receita Médica', fonts, {
    topRightNotes: ['1ª Via Farmácia', '2ª Via Paciente'],
  });

  let y = drawMedicalHeaderBlock(page, args, fonts, dataEmissao);
  drawLabelValue(
    page,
    'Paciente:',
    [args.cpfPaciente, args.nomePaciente].filter(Boolean).join(' - ') || args.nomePaciente || 'Paciente',
    PAGE_MARGIN + 4,
    y,
    fonts
  );
  drawLabelValue(page, 'Data de Validade:', dataValidade, 360, y, fonts);
  y -= 14;
  drawHorizontalRule(page, y);
  y -= 22;

  const items = (args.medicamentos || []).length
    ? args.medicamentos!.map((item, index) => parsePrescriptionItem(item, index + 1))
    : [parsePrescriptionItem(args.observacoes || 'Uso conforme orientação médica.', 1)];

  const listWidth = CONTENT_WIDTH - 54;
  for (const item of items.slice(0, 8)) {
    const subtitle = item.instruction || 'Uso conforme orientação médica.';
    const consumed = drawListEntry(page, fonts, {
      index: item.index,
      title: item.title,
      subtitle,
      quantity: item.quantity,
      y,
      width: listWidth,
    });
    y -= consumed + 10;
    if (y < 240) break;
  }

  if (args.observacoes) {
    const obsTitleY = clamp(y - 4, 208, 250);
    page.drawText('Observações', {
      x: PAGE_MARGIN + 4,
      y: obsTitleY,
      size: 9.4,
      font: fonts.bold,
      color: BORDER_COLOR,
    });

    const obsLines = wrapText(args.observacoes, CONTENT_WIDTH - 8, fonts.regular, 8.6).slice(0, 3);
    let obsY = obsTitleY - 14;
    for (const line of obsLines) {
      page.drawText(line, {
        x: PAGE_MARGIN + 4,
        y: obsY,
        size: 8.6,
        font: fonts.regular,
        color: MUTED_COLOR,
      });
      obsY -= 11;
    }
  }

  drawPrescriptionBoxes(page, fonts);
  drawSignatureFooter(page, fonts, {
    doctorName: args.nomeMedico || Deno.env.get('MEDICO_NOME') || 'Médico Responsável',
    documentLabel: 'Receituário médico',
  });

  return await pdfDoc.save();
};

const toQrBytes = async (value: string, width: number): Promise<Uint8Array> => {
  const qrDataUrl = await QRCode.toDataURL(value, {
    margin: 1,
    width,
  });
  const base64 = qrDataUrl.split(',')[1];
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
};

export const addDownloadQrToGuia = async (
  sourceBytes: Uint8Array,
  downloadUrl: string
): Promise<Uint8Array> => {
  const pdfDoc = await PDFDocument.load(sourceBytes);
  const fonts = await getFonts(pdfDoc);
  const page = pdfDoc.getPages()[0];
  const { width } = page.getSize();
  const qrSize = clamp(Math.round(width * 0.24), 134, 152);
  const qrBytes = await toQrBytes(downloadUrl, qrSize + 16);
  const qrImage = await pdfDoc.embedPng(qrBytes);
  const blockWidth = 260;
  const blockHeight = 220;
  const blockX = (width - blockWidth) / 2;
  const blockY = EXAM_DOWNLOAD_QR_BLOCK_BOTTOM;
  const qrX = (width - qrSize) / 2;
  const qrY = blockY + 28;

  page.drawRectangle({
    x: blockX,
    y: blockY,
    width: blockWidth,
    height: blockHeight,
    color: rgb(1, 1, 1),
  });

  drawCenteredText(page, 'QR Code da Guia', width / 2, blockY + blockHeight - 24, fonts.bold, 12.6);

  page.drawImage(qrImage, {
    x: qrX,
    y: qrY,
    width: qrSize,
    height: qrSize,
  });

  drawCenteredText(page, 'Escaneie para baixar ou imprimir a guia de exames.', width / 2, blockY + 12, fonts.regular, 8.4, MUTED_COLOR);
  drawCenteredText(page, 'Apresente esta guia no laboratório ou farmácia.', width / 2, blockY + 2, fonts.regular, 7.8, MUTED_COLOR);

  return await pdfDoc.save();
};

export const buscarTemplate = async (
  supabase: any,
  templateName: string,
  bucketName = 'guias-exames-templates'
): Promise<Uint8Array | null> => {
  try {
    const { data, error } = await supabase.storage
      .from(bucketName)
      .download(`${templateName}.pdf`);

    if (error || !data) {
      console.warn(`[EXAME-TEMPLATE-HELPER] Template não encontrado: ${bucketName}/${templateName}.pdf`);
      return null;
    }

    return new Uint8Array(await data.arrayBuffer());
  } catch (error) {
    console.warn(`[EXAME-TEMPLATE-HELPER] Falha ao baixar template ${bucketName}/${templateName}.pdf`, error);
    return null;
  }
};
