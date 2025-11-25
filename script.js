const form = document.getElementById("photoshoot-form");
const productIdInput = document.getElementById("product-id");
const petPhotoInput = document.getElementById("pet-photo");
const instructionsInput = document.getElementById("instructions");
const statusEl = document.getElementById("status");
const resultImg = document.getElementById("result-image");
const resultPlaceholder = document.getElementById("result-placeholder");
const generateBtn = document.getElementById("generate-btn");

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const productId = productIdInput.value.trim();
  const file = petPhotoInput.files[0];

  if (!productId || !file) {
    statusEl.textContent = "Please enter a product ID and choose a photo.";
    return;
  }

  generateBtn.disabled = true;
  statusEl.textContent = "Uploading photo and generating image...";
  resultImg.style.display = "none";
  resultPlaceholder.style.display = "block";
  resultPlaceholder.textContent = "Working on it...";

  try {
    // Convert pet image to base64 (without the data: prefix)
    const petImageBase64 = await fileToBase64(file);

    const body = {
      productId,
      petImageBase64,
      instructions: instructionsInput.value,
    };

    const res = await fetch(
      "/.netlify/functions/generate-photoshoot",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Request failed");
    }

    const data = await res.json();

    resultImg.src = `data:image/png;base64,${data.imageBase64}`;
    resultImg.style.display = "block";
    resultPlaceholder.style.display = "none";
    statusEl.textContent = "Done 🎉";
  } catch (err) {
    console.error(err);
    statusEl.textContent = "Something went wrong: " + err.message;
  } finally {
    generateBtn.disabled = false;
  }
});

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      // result is like "data:image/jpeg;base64,AAAA..."
      const base64 = result.split(",")[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
