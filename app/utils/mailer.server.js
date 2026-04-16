import { createConnection } from "net";
import { connect as tlsConnect } from "tls";

/**
 * Custom SMTP email client — zero npm packages.
 * Pure Node.js net/tls modules.
 * Connects to any SMTP relay (Gmail, Outlook, etc.) with STARTTLS + AUTH.
 */

function smtpCommand(socket, command) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`SMTP timeout on: ${command || "connect"}`)), 20000);
    let response = "";

    const onData = (chunk) => {
      response += chunk.toString();
      const lines = response.split("\r\n").filter(Boolean);
      const last = lines[lines.length - 1];
      if (last && /^\d{3}\s/.test(last)) {
        clearTimeout(timeout);
        socket.removeListener("data", onData);
        const code = parseInt(last.substring(0, 3), 10);
        if (code >= 400) reject(new Error(`SMTP ${code}: ${response.trim()}`));
        else resolve(response.trim());
      }
    };

    socket.on("data", onData);
    socket.once("error", (err) => { clearTimeout(timeout); reject(err); });

    if (command) socket.write(command + "\r\n");
  });
}

function upgradeToTls(socket, host) {
  return new Promise((resolve, reject) => {
    const tlsSocket = tlsConnect({ socket, host, rejectUnauthorized: false }, () => resolve(tlsSocket));
    tlsSocket.once("error", reject);
  });
}

/**
 * Send email via SMTP relay with STARTTLS + AUTH LOGIN.
 * Config comes from .env: MAIL_USER, MAIL_PASS, MAIL_FROM
 */
export async function sendMail({ from, fromName, to, subject, html }) {
  const host = "smtp.gmail.com";
  const port = 587;
  const user = process.env.MAIL_USER;
  const pass = process.env.MAIL_PASS;

  if (!user || !pass) throw new Error("MAIL_USER and MAIL_PASS must be set in .env");

  // 1. Connect
  const socket = createConnection({ host, port });
  await new Promise((res, rej) => {
    socket.once("connect", res);
    socket.once("error", rej);
    setTimeout(() => rej(new Error("Connection timeout")), 15000);
  });

  try {
    // 2. Greeting
    await smtpCommand(socket, null);

    // 3. EHLO
    await smtpCommand(socket, `EHLO pumper.run`);

    // 4. STARTTLS
    await smtpCommand(socket, "STARTTLS");
    const tls = await upgradeToTls(socket, host);

    // 5. EHLO again after TLS
    await smtpCommand(tls, `EHLO pumper.run`);

    // 6. AUTH LOGIN
    await smtpCommand(tls, "AUTH LOGIN");
    await smtpCommand(tls, Buffer.from(user).toString("base64"));
    await smtpCommand(tls, Buffer.from(pass).toString("base64"));

    // 7. MAIL FROM
    await smtpCommand(tls, `MAIL FROM:<${from}>`);

    // 8. RCPT TO
    await smtpCommand(tls, `RCPT TO:<${to}>`);

    // 9. DATA
    await smtpCommand(tls, "DATA");

    const boundary = `----pendora_${Date.now().toString(36)}`;
    const messageId = `<${Date.now()}.${Math.random().toString(36).slice(2)}@pumper.run>`;

    const message = [
      `From: "${fromName}" <${from}>`,
      `To: ${to}`,
      `Subject: ${subject}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: ${messageId}`,
      `MIME-Version: 1.0`,
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      `X-Mailer: Pendora`,
      ``,
      `--${boundary}`,
      `Content-Type: text/html; charset=UTF-8`,
      `Content-Transfer-Encoding: 7bit`,
      ``,
      html,
      ``,
      `--${boundary}--`,
      `.`,
    ].join("\r\n");

    await smtpCommand(tls, message);

    // 10. QUIT
    tls.write("QUIT\r\n");
    tls.end();
    console.log(`[Pendora Mail] Sent to ${to} via ${host}`);
  } catch (err) {
    try { socket.write("QUIT\r\n"); socket.end(); } catch {}
    throw err;
  }
}
