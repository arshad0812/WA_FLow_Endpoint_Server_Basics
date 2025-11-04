export const getNextScreen = async (decryptedBody) => {
  const { screen, data, action } = decryptedBody;

  // 🟢 Meta Health Check
  if (action === "ping") {
    return { data: { status: "active" } };
  }

  // 🟢 Start of flow
  if (action === "INIT") {
    console.log("👉 INIT received");

    return {
      screen: "SCREEN_ONE",
      data: {
        all_extras: [
          { id: "1", title: "Fries 🍟" },
          { id: "2", title: "Coleslaw 🥗" },
          { id: "3", title: "Coke 🥤" }
        ]
      }
    };
  }

  // 🟢 Handle form submission (Submit button click)
  if (action === "complete" && screen === "SCREEN_ONE") {
    const selectedExtras = data?.extras || [];

    console.log("📥 User selected extras:", selectedExtras);

    const confirmationMessage =
      selectedExtras.length > 0
        ? `✅ You selected: ${selectedExtras
            .map((e) =>
              e === "1" ? "Fries 🍟" : e === "2" ? "Coleslaw 🥗" : "Coke 🥤"
            )
            .join(", ")}`
        : "⚠️ You didn’t select any extras.";

    return {
      screen: "CONFIRM_SCREEN",
      data: {
        confirmation_message: confirmationMessage
      }
    };
  }

  // 🟠 Unhandled cases
  console.error("⚠️ Unhandled flow request:", decryptedBody);
  throw new Error("Unhandled request in flow.js");
};
