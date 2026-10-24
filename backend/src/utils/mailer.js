import nodemailer from "nodemailer";

import { env } from "../config/env.js";

/**
 * Lazily built so a dev machine with no SMTP settings still boots.
 *
 * With `SMTP_HOST` empty the mailer falls back to printing the code to the
 * console — the alternative, a hard failure at `/auth/send-otp`, makes the app
 * unrunnable locally for no security gain (the console is already trusted).
 */
let transporter = null;

export const isMailConfigured = Boolean(env.smtp.host);

function getTransporter() {
  if (!isMailConfigured) {
    return null;
  }

  transporter ??= nodemailer.createTransport({
    host: env.smtp.host,
    port: env.smtp.port,
    secure: env.smtp.secure,
    auth: env.smtp.user
      ? { user: env.smtp.user, pass: env.smtp.password }
      : undefined,
  });

  return transporter;
}

function otpTemplate(code, ttlMinutes) {
  return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f5f7fa;padding:32px">
    <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;padding:32px">
      <h1 style="margin:0 0 8px;font-size:20px;color:#0f172a">Your sign-in code</h1>
      <p style="margin:0 0 24px;font-size:14px;color:#64748b">
        Use this code to sign in to FinPulse. It expires in ${ttlMinutes} minutes.
      </p>
      <div style="font-size:32px;font-weight:700;letter-spacing:10px;text-align:center;
                  color:#0f172a;background:#f1f5f9;border-radius:12px;padding:18px">
        ${code}
      </div>
      <p style="margin:24px 0 0;font-size:12px;color:#94a3b8">
        If you did not request this code, you can safely ignore this email.
        Never share it with anyone.
      </p>
    </div>
  </div>`;
}

/**
 * Sends the OTP.
 *
 * @returns {Promise<boolean>} true when the code actually left over SMTP; false
 *   when it was only logged (dev mode). The caller uses this to decide whether
 *   it is allowed to echo the code back in the response.
 */
export async function sendOtpEmail(email, code) {
  const mail = getTransporter();

  if (!mail) {
    console.log(
      `[mail:dev] OTP for ${email} -> ${code} (expires in ${env.otp.ttlMinutes}m)`,
    );

    return false;
  }

  try {
    await mail.sendMail({
      from: env.smtp.from,
      to: email,
      subject: `${code} is your FinPulse sign-in code`,
      text: `Your FinPulse sign-in code is ${code}. It expires in ${env.otp.ttlMinutes} minutes.`,
      html: otpTemplate(code, env.otp.ttlMinutes),
    });
    console.log(`[mail:success] OTP email sent successfully to ${email}`);
    return true;
  } catch (error) {
    console.error(
      `[mail:error] Failed to send OTP email to ${email}:`,
      error.message,
    );
    if (error.code) {
      console.error(
        `[mail:error] Error code: ${error.code}, command: ${error.command}`,
      );
    }
    throw error;
  }
}

function userInvitationTemplate({
  email,
  userName,
  companyName,
  tenantName,
  roleName,
  loginUrl = "#",
}) {
  return `
  <div style="font-family:-apple-system,'Segoe UI',Roboto,sans-serif;background:#f1f5f9;padding:40px 20px;">
    <div style="max-width:520px;margin:0 auto;">

      <!-- Brand header -->
      <div style="text-align:center;margin-bottom:24px;">
        <div style="display:inline-block;width:48px;height:48px;border-radius:12px;background:linear-gradient(135deg,#6366f1,#8b5cf6);line-height:48px;text-align:center;font-size:22px;color:#fff;font-weight:700;">
          FP
        </div>
        <p style="margin:12px 0 0;font-size:13px;font-weight:600;letter-spacing:0.5px;color:#94a3b8;text-transform:uppercase;">
          FinPulse
        </p>
      </div>

      <!-- Card -->
      <div style="background:#ffffff;border-radius:16px;box-shadow:0 4px 24px rgba(15,23,42,0.06);overflow:hidden;">

        <!-- Accent bar -->
        <div style="height:4px;background:linear-gradient(90deg,#6366f1,#8b5cf6,#ec4899);"></div>

        <div style="padding:36px 32px;">
          <h1 style="margin:0 0 4px;font-size:22px;color:#0f172a;font-weight:700;">
            You're invited! 🎉
          </h1>
          <p style="margin:0 0 24px;font-size:14px;color:#64748b;">
            Hello${userName ? ` <strong style="color:#334155;">${userName}</strong>` : ""}, someone's been expecting you.
          </p>

          <p style="margin:0 0 24px;font-size:15px;color:#334155;line-height:1.6;">
            You've been added to <strong style="color:#0f172a;">${companyName}</strong> under the
            <strong style="color:#0f172a;">${tenantName}</strong> organization${roleName ? ` as <strong style="color:#0f172a;">${roleName}</strong>` : ""}.
          </p>

          <!-- Info box -->
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;margin-bottom:28px;">
            <p style="margin:0;font-size:12px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:0.3px;">
              Login Email
            </p>
            <p style="margin:4px 0 0;font-size:14px;color:#0f172a;font-weight:600;">
              ${email}
            </p>
          </div>

          <!-- CTA -->
          <div style="text-align:center;margin-bottom:8px;">
            <a href="${loginUrl}" style="display:inline-block;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:13px 32px;border-radius:10px;box-shadow:0 4px 12px rgba(99,102,241,0.35);">
              Sign in to your account →
            </a>
          </div>
        </div>

        <!-- Footer strip -->
        <div style="background:#f8fafc;padding:16px 32px;border-top:1px solid #f1f5f9;">
          <p style="margin:0;font-size:12px;color:#94a3b8;text-align:center;line-height:1.5;">
            If you weren't expecting this invitation, please contact your administrator or ignore this email.
          </p>
        </div>
      </div>

      <p style="text-align:center;margin:24px 0 0;font-size:12px;color:#b0b8c4;">
        © ${new Date().getFullYear()} FinPulse. All rights reserved.
      </p>
    </div>
  </div>`;
}

/**
 * Sends an invitation email to a newly created/added user.
 *
 * @param {Object} params
 * @param {string} params.email
 * @param {string} [params.userName]
 * @param {string} params.companyName
 * @param {string} params.tenantName
 * @param {string} [params.roleName]
 * @returns {Promise<boolean>}
 */
export async function sendUserInvitationEmail({
  email,
  userName,
  companyName,
  tenantName,
  roleName,
}) {
  const mail = getTransporter();

  if (!mail) {
    console.log(
      `[mail:dev] Invitation email for ${email} -> Company: ${companyName}, Tenant: ${tenantName}`,
    );
    return false;
  }

  try {
    await mail.sendMail({
      from: env.smtp.from,
      to: email,
      subject: `You have been invited to ${companyName} (${tenantName})`,
      text: `Hello${userName ? ` ${userName}` : ""},\n\nYou have been invited and registered in ${companyName} under the ${tenantName} organization${roleName ? ` with the role of ${roleName}` : ""}.\n\nYou can now sign in using your email: ${email}.`,
      html: userInvitationTemplate({
        email,
        userName,
        companyName,
        tenantName,
        roleName,
      }),
    });
    console.log(
      `[mail:success] Invitation email sent successfully to ${email}`,
    );
    return true;
  } catch (error) {
    console.error(
      `[mail:error] Failed to send invitation email to ${email}:`,
      error.message,
    );
    if (error.code) {
      console.error(
        `[mail:error] Error code: ${error.code}, command: ${error.command}`,
      );
    }
    return false;
  }
}
