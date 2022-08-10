import axios, { AxiosError } from "axios";
import { createHmac, randomBytes } from "crypto";
import { stringify } from "querystring";

/**
 * 環境変数
 */
require("dotenv").config();

if (!process.env.NICEHASH_API_KEY)
  throw new Error("NICEHASH_API_KEY is not set");
if (!process.env.NICEHASH_API_SECRET)
  throw new Error("NICEHASH_API_SECRET is not set");
if (!process.env.NICEHASH_ORG_ID) throw new Error("NICEHASH_ORG_ID is not set");
if (!process.env.DISCORD_WEBHOOK_URL)
  throw new Error("DISCORD_WEBHOOK_URL is not set");

const NICEHASH_API_KEY = process.env.NICEHASH_API_KEY;
const NICEHASH_API_SECRET = process.env.NICEHASH_API_SECRET;
const NICEHASH_ORG_ID = process.env.NICEHASH_ORG_ID;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

/**
 * 各種定数
 */
const APP_NAME = "nhnotifier" as const;
const APP_VERSION = "1.0.1" as const;
const NICEHASH_API_HOST = "https://api2.nicehash.com" as const;
const USER_AGENT =
  `${APP_NAME}/${APP_VERSION} (+https://github.com/iamtakagi/nhnotifier)` as const;
const DISCORD_WEBHOOK_USERNAME = "NiceHash QuickMiner" as const;

declare module NicehashRigs {
  interface MinerStatuses {
    MINING: number;
  }

  interface RigTypes {
    MANAGED: number;
  }

  interface DevicesStatuses {
    MINING: number;
    DISABLED: number;
  }

  interface DeviceType {
    enumName: string;
    description: string;
  }

  interface Status {
    enumName: string;
    description: string;
  }

  interface PowerMode {
    enumName: string;
    description: string;
  }

  interface Speed {
    algorithm: string;
    title: string;
    speed: string;
    displaySuffix: string;
  }

  interface Intensity {
    enumName: string;
    description: string;
  }

  interface Device {
    id: string;
    name: string;
    deviceType: DeviceType;
    status: Status;
    temperature: number;
    load: number;
    revolutionsPerMinute: number;
    revolutionsPerMinutePercentage: number;
    powerMode: PowerMode;
    powerUsage: number;
    speeds: Speed[];
    intensity: Intensity;
    nhqm: string;
  }

  interface Algorithm {
    enumName: string;
    description: string;
  }

  interface Stat {
    statsTime: number;
    market: string;
    algorithm: Algorithm;
    unpaidAmount: string;
    difficulty: number;
    proxyId: number;
    timeConnected: number;
    xnsub: boolean;
    speedAccepted: number;
    speedRejectedR1Target: number;
    speedRejectedR2Stale: number;
    speedRejectedR3Duplicate: number;
    speedRejectedR4NTime: number;
    speedRejectedR5Other: number;
    speedRejectedTotal: number;
    profitability: number;
  }

  interface MiningRig {
    rigId: string;
    type: string;
    name: string;
    statusTime: number;
    joinTime: number;
    minerStatus: string;
    groupName: string;
    unpaidAmount: string;
    softwareVersions: string;
    devices: Device[];
    cpuMiningEnabled: boolean;
    cpuExists: boolean;
    stats: Stat[];
    profitability: number;
    localProfitability: number;
    rigPowerMode: string;
  }

  interface Pagination {
    size: number;
    page: number;
    totalPageCount: number;
  }

  interface RootObject {
    minerStatuses: MinerStatuses;
    rigTypes: RigTypes;
    totalRigs: number;
    totalProfitability: number;
    groupPowerMode: string;
    totalDevices: number;
    devicesStatuses: DevicesStatuses;
    unpaidAmount: string;
    path: string;
    btcAddress: string;
    nextPayoutTimestamp: string;
    lastPayoutTimestamp: string;
    miningRigGroups: any[];
    miningRigs: MiningRig[];
    rigNhmVersions: string[];
    externalAddress: boolean;
    totalProfitabilityLocal: number;
    pagination: Pagination;
  }
}

/**
 * Discord Webhook に投げる
 * @param text テキスト
 */
async function postWebhook(
  webhookUrl: string,
  username: string,
  content: string
) {
  return await axios
    .post(
      webhookUrl,
      {
        username,
        content,
      },
      {
        headers: {
          Accept: "application/json",
          "Content-type": "application/json",
        },
      }
    )
    .catch((err) => {
      throw err as AxiosError;
    });
}

function createSignature(
  method: string,
  endpoint: string,
  time: number,
  nonce: string,
  query: string | Record<any, any> | null = null,
  body: string | object | null = null
) {
  const hmac = createHmac("sha256", NICEHASH_API_SECRET);

  hmac.update(
    `${NICEHASH_API_KEY}\0${time}\0${nonce}\0\0${NICEHASH_ORG_ID}\0\0${method.toUpperCase()}\0${endpoint}\0`
  );

  if (query)
    hmac.update(`${typeof query === "object" ? stringify(query) : query}`);
  if (body)
    hmac.update(`\0${typeof body === "object" ? JSON.stringify(body) : body}`);

  return `${NICEHASH_API_KEY}:${hmac.digest("hex")}`;
}

function getRigs() {
  const client = axios.create({
    baseURL: NICEHASH_API_HOST,
  });
  const date = Date.now();
  const nonce = randomBytes(16).toString("base64");

  return new Promise<NicehashRigs.RootObject>((resolve, reject) =>
    client
      .get<NicehashRigs.RootObject>(`/main/api/v2/mining/rigs2`, {
        responseType: "json",
        headers: {
          "X-Time": date,
          "X-Nonce": nonce,
          "X-Organization-Id": NICEHASH_ORG_ID,
          "X-Request-Id": nonce,
          "X-User-Agent": USER_AGENT,
          "X-User-Lang": "ja",
          "X-Auth": createSignature(
            "GET",
            `/main/api/v2/mining/rigs2`,
            date,
            nonce
          ),
        },
      })
      .then(({ data }) => {
        resolve(data);
      })
      .catch((err) => {
        throw err as AxiosError;
      })
  );
}

async function main() {
  const rigs = await getRigs();
  let content = "__**Mining Information**__\n";
  content += `前回の支払い: ${
    new Date(
      new Date(rigs.lastPayoutTimestamp).getTime() +
        (new Date().getTimezoneOffset() + 9 * 60) * 60 * 1000
    ) /* JST */
  }\n次回の支払い: ${
    new Date(
      new Date(rigs.nextPayoutTimestamp).getTime() +
        (new Date().getTimezoneOffset() + 9 * 60) * 60 * 1000
    ) /* JST */
  }\n有効リグ数: ${rigs.totalRigs}\n有効デバイス数: ${
    rigs.totalDevices
  }\nBTC Address: ${rigs.btcAddress}\n\n`;
  rigs.miningRigs.map((rig) => {
    content += `**${rig.name} (${rig.rigId})**\nMiner Status: ${
      rig.minerStatus
    }\nCPU Exists: ${rig.cpuExists}\nCPU Mining Enabled: ${
      rig.cpuMiningEnabled
    }\nSoftware Versions: ${rig.softwareVersions}\n未払いマイニング報酬: ${
      rig.unpaidAmount
    } BTC\nアルゴリズム: ${
      rig.stats[0] ? rig.stats[0].algorithm.description : ""
    }\n`
    rig.devices.map((device) => {
      content += `\n**_ID: ${device.id}_**\nType: ${device.deviceType.description}\n${
        device.status.enumName != `DISABLED`
          ? `:white_check_mark: This device is active.\nステータス: ${
              device.status.description
            } \n採掘速度 (ハッシュレート): ${
              device.speeds[0]
                ? device.speeds[0].speed +
                  " " +
                  device.speeds[0].displaySuffix +
                  "/s"
                : 0
            }\n電力: ${device.powerUsage}W\nモード ${
              device.intensity.description
            }\n`
          : `:x: This device has disabled.`
      }
    `
    });
  });
  await postWebhook(DISCORD_WEBHOOK_URL, DISCORD_WEBHOOK_USERNAME, content);
}

main();
