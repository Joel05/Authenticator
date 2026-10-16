import "mocha";
import * as sinon from "sinon";
import { expect } from "chai";
import { KeyUtilities } from "../models/key-utilities";
import { getOTPAuthPerLineFromOPTAuthMigration } from "../models/migration";
import { OTPAlgorithm, OTPType } from "../models/otp";

// 64 byte key: ASCII "1234567890" x 6 + "1234"
const longSecret =
  "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNA=";

// RFC 6238 (SHA1, 6 digits, 30s) codes for longSecret
const expectedCodes: { [time: number]: string } = {
  59: "779409",
  1111111109: "110091",
  1234567890: "973530",
  2000000000: "155042",
};

// Entry of 96 bytes, single byte protobuf lengths
const shortMigrationUri =
  "otpauth-migration://offline?data=CmAKQDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDEyMzQSEHRlc3RAZXhhbXBsZS5jb20aBFRlc3QgASgBMAIQARgBIAAoAA%3D%3D";

// Entry of 133 bytes, its length is a two byte varint
const longMigrationUri =
  "otpauth-migration://offline?data=CoUBCkAxMjM0NTY3ODkwMTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0EiBtYXgubXVzdGVybWFubkBiZWlzcGllbC1maXJtYS5kZRoZQmVpc3BpZWwgRmlybWEgVlBOIFBvcnRhbCABKAEwAhABGAEgACgA";

function generateAt(secret: string, time: number) {
  const clock = sinon.useFakeTimers(time * 1000);
  try {
    return KeyUtilities.generate(
      OTPType.totp,
      secret,
      0,
      30,
      6,
      OTPAlgorithm.SHA1
    );
  } finally {
    clock.restore();
  }
}

function getSecret(line: string) {
  return new URLSearchParams(line.split("?")[1]).get("secret") || "";
}

describe("64 byte secret", () => {
  for (const time of Object.keys(expectedCodes).map(Number)) {
    it(`generates RFC 6238 code at ${time}`, () => {
      expect(generateAt(longSecret, time)).to.eq(expectedCodes[time]);
    });

    it(`generates RFC 6238 code at ${time} without padding`, () => {
      expect(generateAt(longSecret.replace(/=+$/, ""), time)).to.eq(
        expectedCodes[time]
      );
    });
  }
});

describe("otpauth-migration", () => {
  it("parses entry with single byte lengths", () => {
    const lines = getOTPAuthPerLineFromOPTAuthMigration(shortMigrationUri);
    expect(lines).to.have.length(1);
    expect(getSecret(lines[0])).to.eq(longSecret);
    expect(lines[0]).to.contain("otpauth://totp/test@example.com?");
    expect(lines[0]).to.contain("&issuer=Test&");
  });

  it("parses entry with multi byte varint length", () => {
    const lines = getOTPAuthPerLineFromOPTAuthMigration(longMigrationUri);
    expect(lines).to.have.length(1);
    expect(getSecret(lines[0])).to.eq(longSecret);
    expect(lines[0]).to.contain(
      "otpauth://totp/max.mustermann@beispiel-firma.de?"
    );
    expect(lines[0]).to.contain("&issuer=Beispiel Firma VPN Portal&");
    expect(lines[0]).to.contain("&algorithm=SHA1&digits=6");
  });

  it("generates expected codes from imported secret", () => {
    for (const uri of [shortMigrationUri, longMigrationUri]) {
      const secret = getSecret(getOTPAuthPerLineFromOPTAuthMigration(uri)[0]);
      for (const time of Object.keys(expectedCodes).map(Number)) {
        expect(generateAt(secret, time)).to.eq(expectedCodes[time]);
      }
    }
  });
});
