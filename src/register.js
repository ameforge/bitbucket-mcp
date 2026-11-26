import {registerBranchTools} from "./tools/branch.js";
import {registerPrTools} from "./tools/pr.js";
import {registerPrWriteTools} from "./tools/pr-write.js";
import {registerRepoTools} from "./tools/repo.js";

/** @param {any} server */
export const registerTools = (server) => {
  registerRepoTools(server);
  registerBranchTools(server);
  registerPrTools(server);
  registerPrWriteTools(server);
};
