import { Router } from "express";

const router = Router();

const METERED_DOMAIN = "raju.metered.live";
const METERED_SECRET_KEY = "qqJ_1OopYPZH1tcyb-B287UwKohpisgXxg_Gc_NQupAoFY9x";

const METERED_USERNAME = "ba8689d59f5fa14e1f6d2d19";
const METERED_CREDENTIAL = "Mnb9AOrlnJpd4iv7";

const FALLBACK_ICE_SERVERS = [
  { urls: "stun:stun.relay.metered.ca:80" },
  {
    urls: "turn:global.relay.metered.ca:80",
    username: METERED_USERNAME,
    credential: METERED_CREDENTIAL,
  },
  {
    urls: "turn:global.relay.metered.ca:80?transport=tcp",
    username: METERED_USERNAME,
    credential: METERED_CREDENTIAL,
  },
  {
    urls: "turn:global.relay.metered.ca:443",
    username: METERED_USERNAME,
    credential: METERED_CREDENTIAL,
  },
  {
    urls: "turns:global.relay.metered.ca:443?transport=tcp",
    username: METERED_USERNAME,
    credential: METERED_CREDENTIAL,
  },
];

router.get("/ice-servers", async (req, res) => {
  try {
    const url = `https://${METERED_DOMAIN}/api/v2/turn/credentials?secretKey=${METERED_SECRET_KEY}`;
    const response = await fetch(url);

    if (response.ok) {
      const data = await response.json();
      if (Array.isArray(data)) {
        return res.json({ iceServers: data });
      }
    }

    return res.json({ iceServers: FALLBACK_ICE_SERVERS });
  } catch {
    return res.json({ iceServers: FALLBACK_ICE_SERVERS });
  }
});

export default router;
