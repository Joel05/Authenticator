import * as CryptoJS from "crypto-js";

function byteArray2Base32(bytes: number[]) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const len = bytes.length;
  let result = "";
  let high = 0,
    low = 0,
    sh = 0,
    hasDataInLow = false;
  for (let i = 0; i < len; i += 5) {
    hasDataInLow = true;
    high = 0xf8 & bytes[i];
    result += chars.charAt(high >> 3);
    low = 0x07 & bytes[i];
    sh = 2;

    if (i + 1 < len) {
      high = 0xc0 & bytes[i + 1];
      result += chars.charAt((low << 2) + (high >> 6));
      result += chars.charAt((0x3e & bytes[i + 1]) >> 1);
      low = bytes[i + 1] & 0x01;
      sh = 4;
    }

    if (i + 2 < len) {
      high = 0xf0 & bytes[i + 2];
      result += chars.charAt((low << 4) + (high >> 4));
      low = 0x0f & bytes[i + 2];
      sh = 1;
    }

    if (i + 3 < len) {
      high = 0x80 & bytes[i + 3];
      result += chars.charAt((low << 1) + (high >> 7));
      result += chars.charAt((0x7c & bytes[i + 3]) >> 2);
      low = 0x03 & bytes[i + 3];
      sh = 3;
    }

    if (i + 4 < len) {
      hasDataInLow = false;
      high = 0xe0 & bytes[i + 4];
      result += chars.charAt((low << 3) + (high >> 5));
      result += chars.charAt(0x1f & bytes[i + 4]);
      low = 0;
      sh = 0;
    }
  }

  if (hasDataInLow) {
    result += chars.charAt(low << sh);
  }

  const padlen = 8 - (result.length % 8);
  return result + (padlen < 8 ? Array(padlen + 1).join("=") : "");
}

function wordArrayToByteArray(wordArray: CryptoJS.lib.WordArray) {
  const byteArray: number[] = [];
  for (let i = 0; i < wordArray.words.length; ++i) {
    const word = wordArray.words[i];
    for (let j = 3; j >= 0; --j) {
      byteArray.push((word >> (8 * j)) & 0xff);
    }
  }
  byteArray.length = wordArray.sigBytes;
  return byteArray;
}

function byteArray2String(bytes: number[]) {
  return String.fromCharCode.apply(null, bytes);
}

interface ProtobufField {
  field: number;
  // varint value for wire type 0, bytes for wire type 2
  value: number | number[];
}

// Minimal protobuf reader. Lengths and integers are varints, so they can
// span multiple bytes (e.g. entries >= 128 bytes with long secrets/names)
function readVarint(bytes: number[], offset: number) {
  let value = 0;
  let multiplier = 1;
  let byte: number;
  do {
    if (offset >= bytes.length) {
      throw new Error("Invalid protobuf varint");
    }
    byte = bytes[offset++];
    value += (byte & 0x7f) * multiplier;
    multiplier *= 128;
  } while (byte & 0x80);
  return { value, offset };
}

function readProtobufFields(bytes: number[]) {
  const fields: ProtobufField[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    const tag = readVarint(bytes, offset);
    offset = tag.offset;
    const field = Math.floor(tag.value / 8);
    const wireType = tag.value % 8;
    if (wireType === 0) {
      const varint = readVarint(bytes, offset);
      offset = varint.offset;
      fields.push({ field, value: varint.value });
    } else if (wireType === 2) {
      const length = readVarint(bytes, offset);
      offset = length.offset;
      if (offset + length.value > bytes.length) {
        throw new Error("Invalid protobuf length");
      }
      fields.push({
        field,
        value: bytes.slice(offset, offset + length.value),
      });
      offset += length.value;
    } else if (wireType === 1) {
      offset += 8;
    } else if (wireType === 5) {
      offset += 4;
    } else {
      throw new Error("Unsupported protobuf wire type");
    }
  }
  return fields;
}

export function getOTPAuthPerLineFromOPTAuthMigration(migrationUri: string) {
  if (!migrationUri.startsWith("otpauth-migration:")) {
    return [];
  }

  const base64Data = decodeURIComponent(migrationUri.split("data=")[1]);
  const wordArrayData = CryptoJS.enc.Base64.parse(base64Data);
  const byteData = wordArrayToByteArray(wordArrayData);
  const lines: string[] = [];

  let payload: ProtobufField[];
  try {
    payload = readProtobufFields(byteData);
  } catch (error) {
    console.error(error);
    return [];
  }

  // MigrationPayload.otp_parameters = 1
  for (const otpParameters of payload) {
    if (otpParameters.field !== 1 || typeof otpParameters.value === "number") {
      continue;
    }

    let parameters: ProtobufField[];
    try {
      parameters = readProtobufFields(otpParameters.value);
    } catch (error) {
      console.error(error);
      continue;
    }

    let secret = "";
    let account = "";
    let issuer = "";
    let algorithm = "SHA1";
    let digits = 6;
    let type = "totp";
    let counter = 1;
    for (const { field, value } of parameters) {
      if (typeof value === "number") {
        switch (field) {
          case 4:
            algorithm =
              ["SHA1", "SHA1", "SHA256", "SHA512", "MD5"][value] || "SHA1";
            break;
          case 5:
            digits = [6, 6, 8][value] || 6;
            break;
          case 6:
            type = ["totp", "hotp", "totp"][value] || "totp";
            break;
          case 7:
            counter = value;
            break;
        }
      } else {
        switch (field) {
          case 1:
            secret = byteArray2Base32(value);
            break;
          case 2:
            account = byteArray2String(value);
            break;
          case 3:
            issuer = byteArray2String(value);
            break;
        }
      }
    }

    if (!secret) {
      continue;
    }

    let line = `otpauth://${type}/${account}?secret=${secret}&issuer=${issuer}&algorithm=${algorithm}&digits=${digits}`;
    if (type === "hotp") {
      line += `&counter=${counter}`;
    }
    lines.push(line);
  }
  return lines;
}
