export interface Env {
  BANNED_IPs: KVNamespace;
  ALLOWED: KVNamespace;
  MAILGUN_API_KEY: string;
}

const sendPattern = new URLPattern({ pathname: "/send" });
const blockPattern = new URLPattern({ pathname: "/block/:ip" });
const unblockPattern = new URLPattern({ pathname: "/unblock/:ip" });
const listBlockPattern = new URLPattern({ pathname: "/blocklist" });

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return new Promise((resolve) => {
      async function safeOperation(
        operation: () => Promise<Response>
      ): Promise<Response> {
        if (request.method == "POST") {
          return operation();
        } else {
          return new Response(
            `
          <form method="POST">
            <button type="submit">Complete operation</button>
          </form>
          <script>
            document.querySelector("form").submit();
          </script>
        `,
            {
              headers: {
                "content-type": "text/html;charset=UTF-8",
              },
            }
          );
        }
      }
      async function registerRoute(
        pattern: URLPattern,
        handler: (pattern: URLPatternURLPatternResult) => Promise<Response>
      ) {
        if (pattern.test(request.url)) {
          const result = pattern.exec(request.url);
          if (!result) throw new Error("Pattern does not match itself");
          resolve(handler(result));
        }
      }
      registerRoute(sendPattern, async () => {
        const originIP = request.headers.get("CF-Connecting-IP");
        const overrideIP = request.headers.get("Override-Connecting-IP");
        if (overrideIP) {
          console.log("Overriding IP", overrideIP);
        }
        const senderIP = overrideIP ?? originIP;

        const formData = await request.formData();

        const senderName = formData.get("name")?.toString();
        const senderContact = formData.get("contact")?.toString();
        const messageBody = formData.get("body")?.toString();
        const messageTitle = formData.get("subject")?.toString() ?? senderName;
        const selectedTo = formData.get("to")?.toString();
        const replyTo = senderContact?.includes("@")
          ? senderContact
          : undefined;

        console.log("originIP", originIP);
        console.log("overrideIP", overrideIP);
        console.log("senderContact", senderContact);
        console.log("messageBody", messageBody);
        console.log("messageTitle", messageTitle);
        console.log("selectedTo", selectedTo);
        console.log("replyTo", replyTo);

        if (
          !senderIP ||
          !senderName ||
          !senderContact ||
          !messageTitle ||
          !messageBody ||
          !selectedTo
        )
          throw new Error("Missing Data");

        const to = await env.ALLOWED.get(selectedTo);
        if (!selectedTo) throw new Error("No such contact");

        const isBanned = (await env.BANNED_IPs.get(senderIP)) == "BAN";
        if (isBanned) throw new Error(`${senderIP} is banned`);

        await fetch("https://api.mailgun.net/v3/mg.knyazev.io/messages", {
          headers: {
            Authorization: "Basic " + btoa(env.MAILGUN_API_KEY).toString(),
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: encodeURI(
            `from=contact@mg.knyazev.io&to=${to}&subject=Message from website ${messageTitle}&template=contact-message&v:title=${messageTitle}&v:message=${messageBody}&v:name=${senderName}&v:contact=${senderContact}&v:ip=${senderIP}`
          ),
          method: "POST",
        });

        return new Response("Message sent");
      });

      registerRoute(
        blockPattern,
        async ({
          pathname: {
            groups: { ip },
          },
        }) => {
          return safeOperation(async () => {
            if (ip) env.BANNED_IPs.put(ip, "BAN");
            return new Response(`Banned ${ip} from sending mail`);
          });
        }
      );
      registerRoute(
        unblockPattern,
        async ({
          pathname: {
            groups: { ip },
          },
        }) => {
          return safeOperation(async () => {
            if (ip) env.BANNED_IPs.put(ip, "ALLOW");

            return new Response(`Unbanned ${ip} from sending mail`);
          });
        }
      );
      registerRoute(listBlockPattern, async () => {
        const bannedIPs = await env.BANNED_IPs.list();
        const table = await Promise.all(
          bannedIPs.keys
            .map((k) => k.name)
            .map(async (key) => ({
              key,
              value: await env.BANNED_IPs.get(key),
            }))
        );

        const stringified = table
          .map((kv) => `${kv.key} ${kv.value}`)
          .join("\n");

        return new Response(stringified);
      });
    });
  },
};

