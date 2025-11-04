import express from "express";
import { decryptRequest, encryptResponse, FlowEndpointException } from "./encryption.js";
import { getNextScreen } from "./flow.js";
import crypto from "crypto";
import dotenv from "dotenv";
import fs from "fs";
dotenv.config();

const app = express();

app.use(
  express.json({
    verify: (req, res, buf, encoding) => {
      req.rawBody = buf?.toString(encoding || "utf8");
    },
  })
);

const { APP_SECRET, PASSPHRASE = "", PORT = "3000" } = process.env;

const PRIVATE_KEY = fs.readFileSync("private_key_pkcs8.pem", "utf8");




app.post("/", async (req, res) => {
  if (!isRequestSignatureValid(req)) return res.status(432).send();

  let decryptedRequest;
  try {
    decryptedRequest = decryptRequest(req.body, PRIVATE_KEY, PASSPHRASE);
  } catch (err) {
    console.error("❌ Decryption error:", err);
    if (err instanceof FlowEndpointException) return res.status(err.statusCode).send();
    return res.status(500).send();
  }

  const { aesKeyBuffer, initialVectorBuffer, decryptedBody } = decryptedRequest;

  console.log("💬 Full Decrypted Request Payload:");
  console.log(JSON.stringify(decryptedBody, null, 2));

  // ✅ Extract user input
  const userInput = decryptedBody?.data?.user_input;
  if (userInput) {
    console.log("📝 User Input Values:");
    Object.entries(userInput).forEach(([key, value]) => {
      console.log(`➡️ ${key}: ${value}`);
    });
  } else {
    console.log("⚠️ No user_input found in decryptedBody");
  }

  

  // Generate flow response
  const response = await getNextScreen(decryptedBody);
  console.log("👉 Response to Encrypt:", response);

  res.send(encryptResponse(response, aesKeyBuffer, initialVectorBuffer));
});

app.get("/", (req, res) => {
  res.send(`<pre>WhatsApp Flow endpoint is running 🚀
POST / to test your flow requests.</pre>`);
});

app.listen(PORT, () => {
  console.log(`✅ Server is listening on port ${PORT}`);
});

function isRequestSignatureValid(req) {
  if (!APP_SECRET) {
    console.warn("⚠️ App Secret not set. Add your app secret in .env for signature validation");
    return true;
  }

  const signatureHeader = req.get("x-hub-signature-256");
  if (!signatureHeader) {
    console.error("❌ Missing signature header");
    return false;
  }

  const signatureBuffer = Buffer.from(signatureHeader.replace("sha256=", ""), "utf-8");
  const hmac = crypto.createHmac("sha256", APP_SECRET);
  const digestString = hmac.update(req.rawBody).digest("hex");
  const digestBuffer = Buffer.from(digestString, "utf-8");

  if (!crypto.timingSafeEqual(digestBuffer, signatureBuffer)) {
    console.error("❌ Error: Request signature did not match");
    return false;
  }
  return true;
}


