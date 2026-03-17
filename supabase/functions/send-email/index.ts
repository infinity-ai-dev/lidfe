import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";
import { Resend } from "npm:resend@4.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY") as string);
const hookSecret = (Deno.env.get("SEND_EMAIL_HOOK_SECRET") as string)?.replace("v1,whsec_", "") ?? "";

const PROJECT_REF = "xradpyucukbqaulzhdab";
const SITE_URL = "https://lidfe.mayacrm.shop";

// Email Subjects
const subjects: Record<string, string> = {
  signup: "Confirme seu cadastro - LiDFE",
  recovery: "Redefina sua senha - LiDFE",
  invite: "Você foi convidado - LiDFE",
  magiclink: "Seu link mágico - LiDFE",
  email_change: "Confirme a alteração de email - LiDFE",
  email_change_new: "Confirme o novo email - LiDFE",
  reauthentication: "Confirme a reautenticação - LiDFE",
};

// HTML Templates
const templates: Record<string, string> = {
  signup: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
      background-color: #f4f4f4;
    }
    .container {
      background-color: #ffffff;
      border-radius: 8px;
      padding: 40px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .header {
      text-align: center;
      margin-bottom: 30px;
    }
    .logo {
      font-size: 28px;
      font-weight: bold;
      color: #4F46E5;
      margin-bottom: 10px;
    }
    h1 {
      color: #1F2937;
      font-size: 24px;
      margin-bottom: 20px;
      text-align: center;
    }
    .message {
      color: #4B5563;
      font-size: 16px;
      margin-bottom: 30px;
      text-align: center;
    }
    .button-container {
      text-align: center;
      margin: 30px 0;
    }
    .button {
      display: inline-block;
      padding: 14px 28px;
      background-color: #4F46E5;
      color: #ffffff !important;
      text-decoration: none;
      border-radius: 6px;
      font-weight: 600;
      font-size: 16px;
      transition: background-color 0.3s;
    }
    .button:hover {
      background-color: #4338CA;
    }
    .alternative {
      margin-top: 30px;
      padding-top: 30px;
      border-top: 1px solid #E5E7EB;
      text-align: center;
      color: #6B7280;
      font-size: 14px;
    }
    .code {
      font-family: 'Courier New', monospace;
      font-size: 24px;
      font-weight: bold;
      color: #4F46E5;
      letter-spacing: 4px;
      text-align: center;
      padding: 10px;
      background-color: #F3F4F6;
      border-radius: 4px;
      margin: 20px 0;
    }
    .footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #E5E7EB;
      text-align: center;
      color: #9CA3AF;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">LiDFE</div>
      <p style="color: #6B7280; margin: 0;">Plataforma Médica Inteligente</p>
    </div>
    
    <h1>Bem-vindo ao LiDFE! 🎉</h1>
    
    <div class="message">
      <p>Olá!</p>
      <p>Obrigado por se cadastrar na nossa plataforma. Para começar a usar o LiDFE, precisamos confirmar seu endereço de email.</p>
    </div>
    
    <div class="button-container">
      <a href="{{confirmation_url}}" class="button">Confirmar Email</a>
    </div>
    
    <div class="alternative">
      <p style="margin-bottom: 10px;">Ou copie e cole este código no aplicativo:</p>
      <div class="code">{{token}}</div>
    </div>
    
    <div class="message">
      <p style="font-size: 14px; color: #6B7280;">
        Se você não criou uma conta no LiDFE, pode ignorar este email com segurança.
      </p>
    </div>
    
    <div class="footer">
      <p>Este é um email automático, por favor não responda.</p>
      <p>&copy; 2025 LiDFE. Todos os direitos reservados.</p>
    </div>
  </div>
</body>
</html>
  `,
  recovery: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
      background-color: #f4f4f4;
    }
    .container {
      background-color: #ffffff;
      border-radius: 8px;
      padding: 40px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .button {
      display: inline-block;
      padding: 14px 28px;
      background-color: #4F46E5;
      color: #ffffff !important;
      text-decoration: none;
      border-radius: 6px;
      font-weight: 600;
      font-size: 16px;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Redefina sua senha</h1>
    <p>Siga este link para redefinir a senha da sua conta:</p>
    <p><a href="{{confirmation_url}}" class="button">Redefinir Senha</a></p>
    <p>Ou use este código: {{token}}</p>
  </div>
</body>
</html>
  `,
};

function generateConfirmationURL(email_data: any): string {
  const baseUrl = `https://${PROJECT_REF}.supabase.co/auth/v1/verify`;
  const params = new URLSearchParams({
    token: email_data.token_hash,
    type: email_data.email_action_type === 'signup' ? 'email' : email_data.email_action_type,
    redirect_to: email_data.redirect_to || SITE_URL,
  });
  return `${baseUrl}?${params.toString()}`;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("not allowed", { status: 400 });
  }

  try {
    const payload = await req.text();
    const headers = Object.fromEntries(req.headers);
    
    if (!hookSecret) {
      console.error('[SEND-EMAIL] SEND_EMAIL_HOOK_SECRET not configured');
      return new Response(
        JSON.stringify({
          error: {
            http_code: 500,
            message: "Email hook secret not configured",
          },
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const wh = new Webhook(hookSecret);
    const { user, email_data } = wh.verify(payload, headers) as {
      user: {
        email: string;
      };
      email_data: {
        token: string;
        token_hash: string;
        redirect_to: string;
        email_action_type: string;
        site_url: string;
        token_new?: string;
        token_hash_new?: string;
      };
    };

    const actionType = email_data.email_action_type;
    const subject = subjects[actionType] || "Notificação - LiDFE";
    
    let template = templates[actionType] || templates.signup;
    const confirmation_url = generateConfirmationURL(email_data);
    
    let htmlBody = template
      .replace(/\{\{confirmation_url\}\}/g, confirmation_url)
      .replace(/\{\{token\}\}/g, email_data.token || "")
      .replace(/\{\{new_token\}\}/g, email_data.token_new || "")
      .replace(/\{\{site_url\}\}/g, email_data.site_url || SITE_URL);

    // Text version
    const textBody = `
${subject}

${actionType === 'signup' ? 'Bem-vindo ao LiDFE! Obrigado por se cadastrar.' : 'Você solicitou uma alteração em sua conta.'}

Clique no link abaixo para confirmar:
${confirmation_url}

Ou use este código: ${email_data.token}

Este é um email automático, por favor não responda.
© 2025 LiDFE. Todos os direitos reservados.
    `.trim();

    const { error } = await resend.emails.send({
      from: "LiDFE <no-reply@lidfe.mayacrm.shop>", // Altere para seu domínio verificado no Resend
      to: [user.email],
      subject: subject,
      html: htmlBody,
      text: textBody,
    });

    if (error) {
      console.error('[SEND-EMAIL] Resend error:', error);
      throw error;
    }

    console.log('[SEND-EMAIL] Email sent successfully to:', user.email);
  } catch (error: any) {
    console.error('[SEND-EMAIL] Error:', error);
    return new Response(
      JSON.stringify({
        error: {
          http_code: error.code || 500,
          message: error.message || "Failed to send email",
        },
      }),
      {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  const responseHeaders = new Headers();
  responseHeaders.set("Content-Type", "application/json");
  return new Response(JSON.stringify({}), {
    status: 200,
    headers: responseHeaders,
  });
});
