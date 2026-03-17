import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { PDFDocument, rgb, StandardFonts } from 'npm:pdf-lib@1.17.1';

// Importar mapeamento expandido de templates
import { EXAME_TEMPLATE_MAP, normalizeExameTitle } from '../shared/exame-template-map.ts';
import { loadLidfeLogoBytes } from '../shared/lidfe-logo.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const loadLogoBytes = async (): Promise<Uint8Array | null> => {
  return await loadLidfeLogoBytes();
};

async function generateTemplate(tipoExame: string): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const page = pdfDoc.addPage([595, 842]); // A4
  const { width, height } = page.getSize();

  // Cabeçalho simples
  const headerHeight = 70;
  page.drawRectangle({
    x: 0,
    y: height - headerHeight,
    width,
    height: headerHeight,
    color: rgb(0.2, 0.4, 0.8),
  });

  const logoBytes = await loadLogoBytes();
  let headerX = 40;
  const logoTargetHeight = 32;
  const logoY = height - headerHeight + Math.round((headerHeight - logoTargetHeight) / 2);

  if (logoBytes) {
    const logoImage = await pdfDoc.embedPng(logoBytes);
    const scale = logoTargetHeight / logoImage.height;
    const logoWidth = Math.round(logoImage.width * scale);
    page.drawImage(logoImage, {
      x: headerX,
      y: logoY,
      width: logoWidth,
      height: logoTargetHeight,
    });
    headerX += logoWidth + 12;
  } else {
    const label = 'LIDFE';
    const labelSize = 18;
    const labelWidth = fontBold.widthOfTextAtSize(label, labelSize);
    page.drawText(label, {
      x: headerX,
      y: logoY + Math.round((logoTargetHeight - labelSize) / 2),
      size: labelSize,
      font: fontBold,
      color: rgb(1, 1, 1),
    });
    headerX += labelWidth + 12;
  }

  const titleSize = 12;
  page.drawText('Guia de Exames', {
    x: headerX,
    y: height - headerHeight + Math.round((headerHeight - titleSize) / 2),
    size: titleSize,
    font: fontRegular,
    color: rgb(1, 1, 1),
  });

  let y = height - 110;

  const drawSection = (title: string, heightBox: number) => {
    page.drawText(title, {
      x: 40,
      y,
      size: 11,
      font: fontBold,
      color: rgb(0.2, 0.4, 0.8),
    });
    y -= 14;
    page.drawRectangle({
      x: 40,
      y: y - heightBox,
      width: width - 80,
      height: heightBox,
      borderColor: rgb(0.6, 0.6, 0.6),
      borderWidth: 1,
    });
    y -= heightBox + 18;
  };

  drawSection('DADOS DO MÉDICO', 50);
  drawSection('DADOS DO PACIENTE', 50);

  page.drawText('EXAME SOLICITADO', {
    x: 40,
    y,
    size: 11,
    font: fontBold,
    color: rgb(0.2, 0.4, 0.8),
  });
  y -= 16;
  page.drawRectangle({
    x: 40,
    y: y - 120,
    width: width - 80,
    height: 120,
    borderColor: rgb(0.6, 0.6, 0.6),
    borderWidth: 1,
  });
  page.drawText(`Tipo: ${tipoExame}`, {
    x: 50,
    y: y - 20,
    size: 10,
    font: fontRegular,
    color: rgb(0.2, 0.2, 0.2),
  });
  y -= 140;

  page.drawText('ASSINATURA', {
    x: 40,
    y,
    size: 11,
    font: fontBold,
    color: rgb(0.2, 0.4, 0.8),
  });
  y -= 16;
  page.drawRectangle({
    x: 40,
    y: y - 40,
    width: width - 80,
    height: 40,
    borderColor: rgb(0.6, 0.6, 0.6),
    borderWidth: 1,
  });

  pdfDoc.setTitle(`Guia de Exames - ${tipoExame}`);
  pdfDoc.setAuthor('LIDFE');
  pdfDoc.setSubject('Template de Solicitação de Exame Médico');
  pdfDoc.setProducer('LIDFE App');
  pdfDoc.setCreator('LIDFE App');

  return await pdfDoc.save();
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization') || '';
    const apiKeyHeader = req.headers.get('apikey') || '';
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? 'https://xradpyucukbqaulzhdab.supabase.co';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    if (!supabaseServiceKey) {
      throw new Error('Service Role Key não encontrada');
    }

    const providedToken = apiKeyHeader || (authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : '');
    if (!providedToken || providedToken !== supabaseServiceKey) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 401,
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      global: {
        headers: {
          Authorization: `Bearer ${supabaseServiceKey}`,
          apikey: supabaseServiceKey,
        },
      },
    });

    const body = await req.json().catch(() => ({}));
    const { action } = body;

    if (action === 'generate') {
      const templates = Object.values(EXAME_TEMPLATE_MAP);
      const uniqueTemplates = [...new Set(templates)];
      const results: Array<{ template: string; status: string; error?: string }> = [];

      for (const templateName of uniqueTemplates) {
        try {
          const templatePdf = await generateTemplate(templateName);
          const fileName = `${templateName}.pdf`;

          const { error: uploadError } = await supabase.storage
            .from('guias-exames-templates')
            .upload(fileName, templatePdf, {
              contentType: 'application/pdf',
              upsert: true,
            });

          if (uploadError) {
            results.push({ template: templateName, status: 'erro', error: uploadError.message });
          } else {
            results.push({ template: templateName, status: 'sucesso' });
          }
        } catch (error: any) {
          results.push({ template: templateName, status: 'erro', error: error.message });
        }
      }

      return new Response(
        JSON.stringify({
          success: true,
          message: 'Templates gerados',
          results,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        map: EXAME_TEMPLATE_MAP,
        sample: normalizeExameTitle('hemograma completo'),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  } catch (error: any) {
    console.error('[GENERATE-EXAME-TEMPLATES] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || 'Erro desconhecido' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }
});
