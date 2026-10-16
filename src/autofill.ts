// Content script registered only for sites the user enabled auto-fill on.
// It looks for a one-time code field and asks the background for the code
// of the account bound to this site. The background checks the origin, so
// this script never decides which code a page gets.

declare global {
  interface Window {
    __authenticatorAutofill?: boolean;
  }
}

const otpKeywords = [
  "one-time-code",
  "onetimecode",
  "otp",
  "totp",
  "2fa",
  "mfa",
  "twofactor",
  "two-factor",
  "two_factor",
  "authenticator",
  "verification",
  "verify",
  "factor",
  "token",
  "code",
];

// Fields that contain one of the keywords above but are no OTP fields
const ignoredKeywords = [
  "zip",
  "postal",
  "promo",
  "coupon",
  "voucher",
  "gift",
  "country",
  "area",
  "captcha",
  "search",
  "phone",
];

const textInputTypes = ["", "text", "tel", "number", "password"];

const requestedInputs = new WeakSet<HTMLInputElement>();
let pendingInput: HTMLInputElement | null = null;

function isUsableInput(input: HTMLInputElement) {
  return (
    textInputTypes.includes(input.type) &&
    !input.disabled &&
    !input.readOnly &&
    input.getClientRects().length > 0
  );
}

function getDescription(input: HTMLInputElement) {
  return [
    input.name,
    input.id,
    input.autocomplete,
    input.placeholder,
    input.getAttribute("aria-label") || "",
  ]
    .join(" ")
    .toLowerCase();
}

function findOtpInput() {
  const inputs = Array.from(document.getElementsByTagName("input")).filter(
    isUsableInput
  );

  const oneTimeCodeInput = inputs.find(
    (input) => input.autocomplete === "one-time-code"
  );
  if (oneTimeCodeInput) {
    return oneTimeCodeInput;
  }

  return (
    inputs.find((input) => {
      if (input.type === "password") {
        return false;
      }
      const description = getDescription(input);
      return (
        otpKeywords.some((keyword) => description.includes(keyword)) &&
        !ignoredKeywords.some((keyword) => description.includes(keyword))
      );
    }) || null
  );
}

function setInputValue(input: HTMLInputElement, value: string) {
  // Use the native setter so frameworks like React notice the change
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value"
  )?.set;
  if (setter) {
    setter.call(input, value);
  } else {
    input.value = value;
  }
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

// Some sites use one input per digit
function getSplitInputs(firstInput: HTMLInputElement, length: number) {
  const container = firstInput.form || firstInput.parentElement?.parentElement;
  if (!container) {
    return null;
  }

  const inputs = Array.from(container.getElementsByTagName("input")).filter(
    (input) => isUsableInput(input) && input.maxLength === 1
  );
  const start = inputs.indexOf(firstInput);
  const splitInputs = inputs.slice(start, start + length);
  return splitInputs.length === length ? splitInputs : null;
}

function fillCode(code: string) {
  const input = pendingInput;
  pendingInput = null;
  if (!input || !input.isConnected || input.value) {
    return;
  }

  if (input.maxLength === 1) {
    const splitInputs = getSplitInputs(input, code.length);
    if (splitInputs) {
      splitInputs.forEach((splitInput, i) =>
        setInputValue(splitInput, code[i])
      );
      return;
    }
  }

  setInputValue(input, code);
}

function scan() {
  const input = findOtpInput();
  if (!input || input.value || requestedInputs.has(input)) {
    return;
  }

  requestedInputs.add(input);
  pendingInput = input;
  chrome.runtime.sendMessage({ action: "autofillRequest" });
}

if (!window.__authenticatorAutofill) {
  window.__authenticatorAutofill = true;

  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === "autofillCode" && typeof message.code === "string") {
      fillCode(message.code);
    }
  });

  // OTP fields are often added later, e.g. after submitting the password
  let scanTimeout: number | undefined;
  new MutationObserver(() => {
    clearTimeout(scanTimeout);
    scanTimeout = window.setTimeout(scan, 300);
  }).observe(document.documentElement, { childList: true, subtree: true });

  scan();
}

export {};
