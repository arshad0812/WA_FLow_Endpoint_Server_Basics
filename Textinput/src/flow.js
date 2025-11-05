// flow.js
export const getNextScreen = async (decryptedBody) => {
  const { screen, data, action } = decryptedBody;

  // 🟢 Health Check
  if (action === "ping") {
    return { response: { status: "active" } };
  }

  // 🟢 Flow INIT
  if (action === "INIT") {
    console.log("🟢 Flow started");
    return {
      response: {
        screen: "SCREEN_ONE",
        data: {}
      }
    };
  }

  // 🟢 Handle user submission (data_exchange)
  if (action === "data_exchange" && screen === "SCREEN_ONE") {
    // ✅ WhatsApp Flow sends form data under @form or user_input
    const userInput = data?.["@form"] || data?.user_input || data || {};

    // ✅ Match names from your Flow JSON
    const userName = userInput?.name || "Guest";
    const userNumber = userInput?.number || "Unknown";
    const userQuery = userInput?.query || "N/A";

    console.log("📩 User submitted form:", {
      name: userName,
      number: userNumber,
      query: userQuery
    });

    // ✅ Respond with confirmation screen
    return {
      response: {
        screen: "CONFIRM_SCREEN",
        data: {
          confirmation_message: `✅ Thanks ${userName}! We’ll reach out to you at ${userNumber}.`
        }
      }
    };
  }

  console.error("⚠️ Unhandled flow action:", decryptedBody);
  throw new Error("Unhandled request in flow.js");
};
