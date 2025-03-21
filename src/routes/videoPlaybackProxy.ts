import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
let getFetchClientLocation = "getFetchClient";
if (Deno.env.get("GET_FETCH_CLIENT_LOCATION")) {
    if (Deno.env.has("DENO_COMPILED")) {
        getFetchClientLocation = Deno.mainModule.replace("src/main.ts", "") +
            Deno.env.get("GET_FETCH_CLIENT_LOCATION");
    } else {
        getFetchClientLocation = Deno.env.get(
            "GET_FETCH_CLIENT_LOCATION",
        ) as string;
    }
}
const { getFetchClient } = await import(getFetchClientLocation);

const videoPlaybackProxy = new Hono();

videoPlaybackProxy.get("/", async (c) => {
    const { host, c: client, expire } = c.req.query();
    const urlReq = new URL(c.req.url);

    if (host == undefined || !/[\w-]+.googlevideo.com/.test(host)) {
        throw new HTTPException(400, {
            res: new Response("Host query string do not match or undefined."),
        });
    }

    if (
        expire == undefined ||
        Number(expire) < Number(Date.now().toString().slice(0, -3))
    ) {
        throw new HTTPException(400, {
            res: new Response(
                "Expire query string undefined or videoplayback URL has expired.",
            ),
        });
    }

    if (client == undefined) {
        throw new HTTPException(400, {
            res: new Response("'c' query string undefined."),
        });
    }

    const konfigStore = c.get("konfigStore");

    // deno-lint-ignore prefer-const
    let queryParams = new URLSearchParams(urlReq.search);
    queryParams.delete("host");
    const rangeHeader = c.req.header("range");
    const requestBytes = rangeHeader ? rangeHeader.split("=")[1] : null;
    if (requestBytes) {
        queryParams.append(
            "range",
            requestBytes,
        );
    }

    const headersToSend: HeadersInit = {
        "accept": "*/*",
        "accept-encoding": "gzip, deflate, br, zstd",
        "accept-language": "en-us,en;q=0.5",
        "origin": "https://www.youtube.com",
        "referer": "https://www.youtube.com",
    };

    if (client == "ANDROID") {
        headersToSend["user-agent"] =
            "com.google.android.youtube/1537338816 (Linux; U; Android 13; en_US; ; Build/TQ2A.230505.002; Cronet/113.0.5672.24)";
    } else if (client == "IOS") {
        headersToSend["user-agent"] =
            "com.google.ios.youtube/19.32.8 (iPhone14,5; U; CPU iOS 17_6 like Mac OS X;)";
    } else {
        headersToSend["user-agent"] =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
    }

    const fetchClient = await getFetchClient(konfigStore);

    let googlevideoResponse = await fetchClient.call(
        undefined,
        `https://${host}/videoplayback?${queryParams.toString()}`,
        {
            method: "POST",
            body: new Uint8Array([0x78, 0]), // protobuf: { 15: 0 } (no idea what it means but this is what YouTube uses),
            headers: headersToSend,
        },
    );

    if (googlevideoResponse.headers.has("location")) {
        googlevideoResponse = await fetchClient.call(
            undefined,
            googlevideoResponse.headers.get("location") as string,
            {
                method: "POST",
                body: new Uint8Array([0x78, 0]), // protobuf: { 15: 0 } (no idea what it means but this is what YouTube uses)
                headers: headersToSend,
            },
        );
    }

    const headersForResponse: Record<string, string> = {
        "content-length": googlevideoResponse.headers.get("content-length") ||
            "",
        "access-control-allow-origin": "*",
        "accept-ranges": googlevideoResponse.headers.get("accept-ranges") || "",
        "content-type": googlevideoResponse.headers.get("content-type") || "",
        "expires": googlevideoResponse.headers.get("expires") || "",
        "last-modified": googlevideoResponse.headers.get("last-modified") || "",
    };

    let responseStatus = googlevideoResponse.status;
    if (requestBytes && responseStatus == 200) {
        responseStatus = 206;
        headersForResponse["content-range"] = `bytes ${requestBytes}/*`;
    }

    return new Response(googlevideoResponse.body, {
        status: responseStatus,
        statusText: googlevideoResponse.statusText,
        headers: headersForResponse,
    });
});

export default videoPlaybackProxy;
