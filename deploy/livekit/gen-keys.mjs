#!/usr/bin/env node
// Generates a LiveKit API key + secret pair (same format as `lk token`/`livekit-server generate-keys`).
import { randomBytes } from "node:crypto";
const key = "API" + randomBytes(9).toString("base64url").replace(/[^A-Za-z0-9]/g, "x").slice(0, 12);
const secret = randomBytes(32).toString("base64url");
console.log(`LIVEKIT_API_KEY=${key}\nLIVEKIT_API_SECRET=${secret}`);
