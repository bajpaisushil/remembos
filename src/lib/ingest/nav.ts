// Navigate from non-React code (toast actions such as "View" / "Open"). Delegates to the shared helper,
// which uses the App Router when the shell has registered it and a normal page load otherwise.
export { navigate } from "../utils";
