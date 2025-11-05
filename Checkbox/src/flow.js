export const getNextScreen = async (decryptedBody) => {
    const { screen, action } = decryptedBody;
  
    if (action === "PING") {
      return { response: { screen: "SCREEN_ONE", data: {} } };
    }
  
    if (action === "INIT") {
      console.log("🟢 Flow started");
  
      // ✅ Example dynamic data source from backend
      const extrasList = [
        { id: "extra1", title: "Extra Cheese" },
        { id: "extra2", title: "Chili Flakes" },
        { id: "extra3", title: "Garlic Sauce" }
      ];
  
      return {
        response: {
          screen: "SCREEN_ONE",
          data: {
            extras_list: extrasList
          }
        }
      };
    }
  
    if (action === "data_exchange" && screen === "SCREEN_ONE") {
      const userInput = decryptedBody?.data?.user_input || {};
      const selectedExtras = userInput.extras || [];
  
      console.log("✅ User selected extras:", selectedExtras);
  
      return {
        response: {
          screen: "CONFIRM_SCREEN",
          data: {
            confirmation_message: `You selected: ${selectedExtras.join(", ")}`
          }
        }
      };
    }
  
    throw new Error("Unhandled flow action");
  };
   