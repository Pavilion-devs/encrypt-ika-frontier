import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";

describe("liquidation_coordinator", () => {
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.liquidationCoordinator as Program;

  it("exposes the liquidation instruction surface", async () => {
    const methods = program.methods;

    if (
      !methods.initializePosition ||
      !methods.checkHealth ||
      !methods.submitBid ||
      !methods.resolveAuction ||
      !methods.requestResolutionDecryption ||
      !methods.finalize
    ) {
      throw new Error("expected liquidation workflow methods to exist in the IDL");
    }
  });
});
