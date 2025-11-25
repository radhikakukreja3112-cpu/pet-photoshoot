// Netlify serverless function
// Talks to Shopify Storefront API + Gemini (Nano Banana)

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent";

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  try {
    const { productId, petImageBase64, instructions } = JSON.parse(event.body || "{}");

    if (!productId || !petImageBase64) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing productId or image" }),
      };
    }

    // 1) Lookup product image from Shopify
    const shopifyProductGid = `gid://shopify/Product/${productId}`;

    const shopifyResp = await fetch(
      `https://${process.env.SHOPIFY_DOMAIN}/api/2025-01/graphql.json`,
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
              }
            }
          `,
          variables: { id: shopifyProductGid },
        }),
      }
    );

    const shopifyData = await shopifyResp.json();
    const productImageUrl =
      shopifyData?.data?.product?.featuredImage?.url;

    if (!productImageUrl) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: "Could not find product image" }),
      };
    }

    // 2) Download product image and convert to base64
    const productImageResp = await fetch(productImageUrl);
    const productArrayBuffer = await productImageResp.arrayBuffer();
    const productImageBase64 = Buffer.from(productArrayBuffer).toString(
      "base64"
    );

    // 3) Call Gemini 2.5 Flash Image (Nano Banana)
    const prompt =
      (instructions && instructions.trim()) ||
      "Create a photorealistic marketing image of the dog from image 1 using or wearing the product from image 2. Keep the dog's face consistent and make the product clearly visible for an e-commerce PDP.";

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
      const err = await geminiResp.text();
      console.error("Gemini error:", err);
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
    console.error(err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Server error" }),
    };
  }
};
