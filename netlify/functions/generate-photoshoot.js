// Netlify serverless function
// Talks to Shopify Storefront API + Gemini (Nano Banana)

const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

const SHOPIFY_API_VERSION = "2024-07";
const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent";

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  try {
    const { productId, petImageBase64, instructions } = JSON.parse(
      event.body || "{}"
    );

    if (!productId || !petImageBase64) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing productId or image" }),
      };
    }

    // 1) Lookup product image from Shopify
    const shopifyProductGid = `gid://shopify/Product/${productId}`;

    const shopifyResp = await fetch(
      `https://${process.env.SHOPIFY_DOMAIN}/api/${SHOPIFY_API_VERSION}/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Storefront-Access-Token":
            process.env.SHOPIFY_STOREFRONT_TOKEN,
        },
        body: JSON.stringify({
          query: `
            query ProductImage($id: ID!) {
              product(id: $id) {
                title
                featuredImage { url }
                images(first: 1) {
                  edges {
                    node {
                      url
                    }
                  }
                }
              }
            }
          `,
          variables: { id: shopifyProductGid },
        }),
      }
    );

    const shopifyText = await shopifyResp.text();
    let shopifyData = null;
    try {
      shopifyData = JSON.parse(shopifyText);
    } catch (e) {
      console.error("Could not parse Shopify JSON:", shopifyText);
    }

    if (!shopifyResp.ok) {
      console.error("Shopify API error:", shopifyResp.status, shopifyText);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Shopify API error" }),
      };
    }

    const product = shopifyData?.data?.product;

    const productImageUrl =
      product?.featuredImage?.url ||
      product?.images?.edges?.[0]?.node?.url ||
      null;

    if (!productImageUrl) {
      console.error("Shopify product response:", JSON.stringify(shopifyData));
      return {
        statusCode: 404,
        body: JSON.stringify({
          error: "Could not find product image in Shopify response",
        }),
      };
    }

    // 2) Download product image and convert to base64
    const productImageResp = await fetch(productImageUrl);
    const productArrayBuffer = await productImageResp.arrayBuffer();
    const productImageBase64 = Buffer.from(productArrayBuffer).toString(
      "base64"
    );

    // 3) Build prompt for Gemini
    const basePrompt = `
You are generating marketing photos for an online pet store.

Image 1: the original pet photo.
Image 2: a product photo from our catalogue.

Task:
- Create ONE new, photorealistic image.
- The dog from image 1 should be using or wearing the product from image 2.
- Keep the dog's face, markings, and pose natural.
- Make the product clearly visible and realistic, suitable for a Shopify PDP.
- Use a clean, well-lit background as if from a professional studio shoot.
`;

    const prompt =
      instructions && instructions.trim()
        ? basePrompt + "\n\nExtra user instructions: " + instructions.trim()
        : basePrompt;

    // 4) Call Gemini 2.5 Flash Image
    const geminiResp = await fetch(
      `${GEMINI_URL}?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                { text: prompt },
                {
                  inlineData: {
                    mimeType: "image/jpeg",
                    data: petImageBase64,
                  },
                },
                {
                  inlineData: {
                    mimeType: "image/jpeg",
                    data: productImageBase64,
                  },
                },
              ],
            },
          ],
        }),
      }
    );

    if (!geminiResp.ok) {
      const errText = await geminiResp.text();
      console.error("Gemini API error:", geminiResp.status, errText);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Gemini API failed" }),
      };
    }

    const geminiData = await geminiResp.json();

    const candidate = geminiData?.candidates?.[0];
    const partWithImage = candidate?.content?.parts?.find(
      (p) => p.inlineData
    );

    if (!partWithImage) {
      console.error("Gemini response missing image:", JSON.stringify(geminiData));
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "No image returned from Gemini" }),
      };
    }

    const outputBase64 = partWithImage.inlineData.data;

    return {
      statusCode: 200,
      body: JSON.stringify({ imageBase64: outputBase64 }),
    };
  } catch (err) {
    console.error("Server error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Server error" }),
    };
  }
};
