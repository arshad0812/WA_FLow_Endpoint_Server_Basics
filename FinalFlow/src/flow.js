export const getNextScreen = async (decryptedBody) => {
  const { action, screen, data } = decryptedBody;

  switch (action) {
    case "ping":
      return { data: { status: "active" } };

    case "INIT":
      return { screen: "SCREEN_ONE", data: {} };

    case "data_exchange":
      console.log("📡 Data exchange received:", data);
      return { screen, data: { updated: true } };

    case "navigate":
      console.log("➡️ Navigating to next screen");
      return { screen: "SCREEN_TWO", data: {} };

    case "complete":
      console.log("✅ Flow completed. User data:", data);
      return { action: "complete", data: { success: true } };

    default:
      console.error("⚠️ Unknown action:", action);
      throw new Error("Unhandled action type");
  }
};
