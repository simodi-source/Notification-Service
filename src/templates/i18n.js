/** Email/push copy catalogs for notification-service. */

const EN = {
  otpLabel: "Your OTP Code",
  greetingThere: "there",
  auth_otp: {
    subject: "Simodi — Login OTP",
    eyebrow: "Login verification",
    heading: "Your one-time code",
    intro: "We received a login request for your Simodi account. Use the code below to continue.",
    footnote: (mins) =>
      `This code is valid for ${mins} minutes. If you did not request this, please ignore this email.`,
  },
  auth_password_reset: {
    subject: "Simodi — Password reset request",
    eyebrow: "Password reset",
    heading: "Reset your Simodi password",
    intro:
      "We received a request to reset the password on your Simodi account. Enter the verification code below in the app to set a new password.",
    expires: (mins) => `This code expires in ${mins} minutes and can be used only once.`,
    footnote:
      "If you did not request a password reset, you can safely ignore this email — your password will remain unchanged. For your security, never share this code with anyone, including Simodi staff.",
  },
  admin_mfa_otp: {
    subject: (adminName, adminRoles) => `Simodi Admin MFA — ${adminName} (${adminRoles})`,
    eyebrow: "Admin sign-in",
    heading: "Sign-in code for an admin",
    intro: (adminName, adminEmail, adminRoles) =>
      `${adminName} (${adminEmail}) is signing in as ${adminRoles}. Give them this code only if you expect this login.`,
    expires: (mins) => `This code expires in ${mins} minutes and can be used only once.`,
    footnote:
      "If you did not expect this, do not share the code and disable the account. Never send this code by email to the person signing in unless you have confirmed the request.",
  },
  wallet_withdrawal_otp: {
    subject: "Simodi — Withdrawal verification",
    eyebrow: "Withdrawal verification",
    heading: "Confirm your withdrawal request",
    intro:
      "We received a request to withdraw funds from your Simodi wallet. Enter the verification code below in the app to submit your withdrawal.",
    expires: (mins) => `This code expires in ${mins} minutes and can be used only once.`,
    footnote:
      "If you did not request a withdrawal, please ignore this email and contact our support team immediately. Never share this code with anyone, including Simodi staff.",
  },
  kyc_approved: {
    subject: "Simodi — Identity verification approved",
    eyebrow: "KYC update",
    heading: "Your identity has been verified",
    intro:
      "Your identity verification has been approved. You now have full access to deposits, withdrawals, and trading on Simodi.",
    footnote: "Open the Simodi app to start trading gold and silver.",
    pushTitle: "Identity verified",
    pushBody: "Your KYC is complete. You can now trade and withdraw.",
  },
  kyc_rejected: {
    subject: "Simodi — Identity verification update",
    eyebrow: "KYC update",
    heading: "Action required on your verification",
    intro: "We were unable to approve your identity verification at this time.",
    paragraph:
      "Please open the Simodi app and retry the verification, making sure your documents are clear and your selfie is well lit. If you need help, our support team is available.",
    footnote: "Until verification is complete, deposits and trading remain limited.",
    pushTitle: "KYC update required",
    pushBody: "Please retry identity verification in the app.",
  },
};

const AR = {
  otpLabel: "رمز التحقق الخاص بك",
  greetingThere: "مرحباً",
  auth_otp: {
    subject: "سيمودي — رمز تسجيل الدخول",
    eyebrow: "التحقق من تسجيل الدخول",
    heading: "رمزك لمرة واحدة",
    intro: "استلمنا طلب تسجيل دخول لحسابك في سيمودي. استخدم الرمز أدناه للمتابعة.",
    footnote: (mins) =>
      `هذا الرمز صالح لمدة ${mins} دقائق. إذا لم تطلب ذلك، تجاهل هذا البريد.`,
  },
  auth_password_reset: {
    subject: "سيمودي — طلب إعادة تعيين كلمة المرور",
    eyebrow: "إعادة تعيين كلمة المرور",
    heading: "أعد تعيين كلمة مرور سيمودي",
    intro:
      "استلمنا طلباً لإعادة تعيين كلمة مرور حسابك في سيمودي. أدخل رمز التحقق أدناه في التطبيق لتعيين كلمة مرور جديدة.",
    expires: (mins) => `ينتهي هذا الرمز خلال ${mins} دقائق ويمكن استخدامه مرة واحدة فقط.`,
    footnote:
      "إذا لم تطلب إعادة تعيين كلمة المرور، يمكنك تجاهل هذا البريد بأمان — ستبقى كلمة مرورك كما هي. لا تشارك هذا الرمز مع أي شخص.",
  },
  admin_mfa_otp: {
    subject: (adminName, adminRoles) => `سيمودي — رمز دخول المسؤول — ${adminName} (${adminRoles})`,
    eyebrow: "تسجيل دخول المسؤول",
    heading: "رمز تسجيل دخول لمسؤول",
    intro: (adminName, adminEmail, adminRoles) =>
      `${adminName} (${adminEmail}) يحاول تسجيل الدخول بصلاحية ${adminRoles}. أعطه هذا الرمز فقط إذا كنت تتوقع هذا الدخول.`,
    expires: (mins) => `ينتهي هذا الرمز خلال ${mins} دقائق ويمكن استخدامه مرة واحدة فقط.`,
    footnote:
      "إذا لم تكن تتوقع هذا الدخول، لا تشارك الرمز وعطّل الحساب.",
  },
  wallet_withdrawal_otp: {
    subject: "سيمودي — التحقق من السحب",
    eyebrow: "التحقق من السحب",
    heading: "أكد طلب السحب",
    intro:
      "استلمنا طلباً لسحب أموال من محفظة سيمودي. أدخل رمز التحقق أدناه في التطبيق لإرسال طلب السحب.",
    expires: (mins) => `ينتهي هذا الرمز خلال ${mins} دقائق ويمكن استخدامه مرة واحدة فقط.`,
    footnote:
      "إذا لم تطلب سحباً، تجاهل هذا البريد وتواصل مع الدعم فوراً. لا تشارك هذا الرمز مع أي شخص.",
  },
  kyc_approved: {
    subject: "سيمودي — تمت الموافقة على التحقق من الهوية",
    eyebrow: "تحديث التحقق من الهوية",
    heading: "تم التحقق من هويتك",
    intro:
      "تمت الموافقة على التحقق من هويتك. أصبح لديك وصول كامل للإيداع والسحب والتداول على سيمودي.",
    footnote: "افتح تطبيق سيمودي لبدء تداول الذهب والفضة.",
    pushTitle: "تم التحقق من الهوية",
    pushBody: "اكتمل التحقق. يمكنك الآن التداول والسحب.",
  },
  kyc_rejected: {
    subject: "سيمودي — تحديث التحقق من الهوية",
    eyebrow: "تحديث التحقق من الهوية",
    heading: "مطلوب إجراء على التحقق",
    intro: "تعذر الموافقة على التحقق من هويتك في الوقت الحالي.",
    paragraph:
      "افتح تطبيق سيمودي وأعد المحاولة مع التأكد من وضوح المستندات وجودة الصورة الشخصية. فريق الدعم متاح للمساعدة.",
    footnote: "حتى يكتمل التحقق، تبقى الإيداعات والتداول محدودة.",
    pushTitle: "مطلوب تحديث التحقق",
    pushBody: "يرجى إعادة محاولة التحقق من الهوية في التطبيق.",
  },
};

function resolveLocale(locale) {
  return locale === "ar" ? "ar" : "en";
}

function catalog(locale) {
  return resolveLocale(locale) === "ar" ? AR : EN;
}

module.exports = {
  resolveLocale,
  catalog,
  EN,
  AR,
};
