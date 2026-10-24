"use client";
import { createAuthClient } from "@neondatabase/auth/next";

// This client talks to our same-origin /api/auth proxy, never directly to D1 or
// a browser-supplied identity endpoint.
export const authClient = createAuthClient();
