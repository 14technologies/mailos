export const DEFAULT_EMAIL_TEMPLATE_HTML = `<!doctype html>
<html><body style="margin:0;background:#f3f6f5;padding:32px 12px;font-family:Arial,Helvetica,sans-serif;color:#18312d">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e3eae8;border-radius:18px">
<tr><td align="center" style="padding:30px 28px 22px;border-bottom:1px solid #edf1f0">{{logo}}</td></tr>
<tr><td style="padding:28px 32px 32px;font-size:15px;line-height:1.65">{{content}}</td></tr>
<tr><td align="center" style="padding:18px 28px 22px;border-top:1px solid #edf1f0;color:#64736f;font-size:12px;line-height:1.6">Sent by {{appName}} · {{year}}</td></tr>
</table>
</body></html>`;

export const DEFAULT_EMAIL_SAMPLE_HTML = `<p style="margin:0 0 14px">Hello Ayesha,</p>
<p style="margin:0 0 16px">Thanks for choosing <strong>14 Technologies</strong>. Your account is ready.</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:18px 0;background:#eef7f5;border-left:4px solid #00877a;border-radius:12px"><tr><td style="padding:18px 20px"><strong style="color:#00877a">ACCOUNT DETAILS</strong><p style="margin:10px 0 0;color:#173d38">Your custom message content appears here. Use the editor to change the layout, colors, logo, and footer.</p></td></tr></table>
<p style="margin:16px 0"><a href="https://14technologies.com/account/" style="display:inline-block;padding:12px 22px;background:#00877a;color:#ffffff;border-radius:999px;text-decoration:none;font-weight:600">Open account</a></p>
<p style="margin:16px 0 0;color:#64736f;font-size:13px">Need help? Reply to this email and our team will assist you.</p>`;
