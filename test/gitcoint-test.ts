import { expect } from "chai";
import { Contract, Signer, Address } from "locklift";
import { FactorySource } from "../build/factorySource";
import { zeroAddress, EMPTY_TVM_CELL } from "./../scripts/utils";

let gitcoinContract: Contract<FactorySource["GitcoinWarmup"]>;
let signer: Signer;
let tokenRoot: Contract<FactorySource["TokenRoot"]>;

let wallets: any[];

const keyNumber = "0";

const DECIMALS = 6;
const NAME = "Gitcoin Warmup TIP3 Token";
const SYMBOL = "GWT3";
const REWARD = 1000;
const MAX_PLAYERS = 5;
describe("Test GitcoinWarmup contract", async function () {
  before(async () => {
    signer = (await locklift.keystore.getSigner(keyNumber))!;
  });
  describe("Contracts", async function () {
    it("Load contract factory", async function () {
      const gitcoinData =
        locklift.factory.getContractArtifacts("GitcoinWarmup");

      expect(gitcoinData.code).not.to.equal(
        undefined,
        "Code should be available",
      );
      expect(gitcoinData.abi).not.to.equal(
        undefined,
        "ABI should be available",
      );
      expect(gitcoinData.tvc).not.to.equal(
        undefined,
        "tvc should be available",
      );
    });

    it("Deploy contract", async function () {
      const INIT_STATE = 0;
      let accountsFactory = locklift.factory.getAccountsFactory("Account");

      const deploys: Promise<{ account: Object; tx: Object }>[] = [];

      for (let i = 0; i < 5; i++) {
        const signer = (await locklift.keystore.getSigner(i.toString()))!;
        deploys.push(
          accountsFactory.deployNewAccount({
            publicKey: signer.publicKey,
            initParams: {
              _randomNonce: locklift.utils.getRandomNonce(),
            },
            constructorParams: {},
            value: locklift.utils.toNano(300),
          }),
        );
      }
      wallets = (await Promise.all(deploys)).map(o => o.account);
      const wallet = wallets[0];
      const tokenWalletData =
        locklift.factory.getContractArtifacts("TokenWallet");
      let { contract: _tokenRoot } = await locklift.factory.deployContract({
        workchain: 0,
        contract: "TokenRoot",
        publicKey: signer.publicKey,
        initParams: {
          deployer_: new Address(zeroAddress),
          randomNonce_: (Math.random() * 6400) | 0,
          rootOwner_: wallet.address,
          name_: NAME,
          symbol_: SYMBOL,
          decimals_: DECIMALS,
          walletCode_: tokenWalletData.code,
        },
        constructorParams: {
          initialSupplyTo: new Address(zeroAddress),
          initialSupply: 0,
          deployWalletValue: locklift.utils.toNano(10),
          mintDisabled: false,
          burnByRootDisabled: false,
          burnPaused: false,
          remainingGasTo: new Address(zeroAddress),
        },
        value: locklift.utils.toNano(15),
      });
      tokenRoot = _tokenRoot;
      const { contract: gitcoin } = await locklift.factory.deployContract({
        contract: "GitcoinWarmup",
        publicKey: signer.publicKey,
        initParams: {
          _randomNonce: locklift.utils.getRandomNonce(),
        },
        constructorParams: {
          _deployWalletBalance: locklift.utils.toNano(5),
          _reward: REWARD,
          _maxPlayers: MAX_PLAYERS,
          _tokenRoot: tokenRoot.address,
          _maxBid: 100,
        },
        value: locklift.utils.toNano(100),
      });
      gitcoinContract = gitcoin;

      const myWallet = accountsFactory.getAccount(
        wallet.address,
        signer.publicKey,
      );
      await myWallet.runTarget(
        {
          contract: tokenRoot,
          value: locklift.utils.toNano(5),
        },
        tRoot => {
          return tRoot.methods.mint({
            amount: 1500 * 10 ** DECIMALS,
            recipient: gitcoin.address,
            deployWalletValue: locklift.utils.toNano(1),
            remainingGasTo: wallet.address,
            notify: true,
            payload: EMPTY_TVM_CELL,
          });
        },
      );
      const balance = await gitcoinContract.methods.balance({}).call();

      expect(balance.balance).to.be.equal(`${1500 * 10 ** DECIMALS}`);
      expect(
        await locklift.provider
          .getBalance(gitcoinContract.address)
          .then(balance => Number(balance)),
      ).to.be.above(0);
    });
  });
  describe("Interact with contract", async function () {
    it("Game flow", async function () {
      console.log("game address", gitcoinContract.address.toString());
      const RUNS = 1;
      const batchSize = 5;
      const testbids = [1, 3, 5, 7, 9];
      const getNPlayers = async () =>
        Number.parseInt(
          (await gitcoinContract.methods.nowPlayers({}).call()).nowPlayers,
        );

      let nplayers = await getNPlayers();
      let bids;
      for (let n = 0; n < RUNS; n++) {
        console.log("RUN", n + 1);
        const runs: Promise<{ transaction; output? }>[] = [];
        nplayers = await getNPlayers();
        console.log("nowPlayers", nplayers);
        for (let i = 0; i < batchSize - 1; i++) {
          runs.push(
            wallets[i].runTarget(
              {
                contract: gitcoinContract,
                value: locklift.utils.toNano(5),
              },
              gtc => gtc.methods.placeBid({ _number: testbids[i] }),
            ),
          );
        }
        await Promise.all(runs);
        bids = await gitcoinContract.methods.bids({}).call();
        console.log(
          "bids",
          bids.bids.map(([a, b]) => [a.toString(), Number.parseInt(b)]),
        );
        console.log("w last", wallets[batchSize - 1].address.toString());
        try {
          await wallets[batchSize - 1].runTarget(
            {
              contract: gitcoinContract,
              value: locklift.utils.toNano(10),
            },
            gtc => gtc.methods.placeBid({ _number: testbids[batchSize - 1] }),
          );
          bids = await gitcoinContract.methods.bids({}).call();
          console.log(
            "bids",
            bids.bids.map(([a, b]) => [a.toString(), Number.parseInt(b)]),
          );
        } catch (e) {
          console.error(e);
        }
      }

      const { events } = await gitcoinContract.getPastEvents({});

      events.map(e => {
        console.log(e.data._winningNumber, e.data._winningDelta);
        console.log(e.data._winners.map(a => a.toString()));
      });

      const tws: Promise<{ value0: any }>[] = [];
      for (let w of wallets) {
        tws.push(
          tokenRoot.methods
            .walletOf({ answerId: 0, walletOwner: w.address })
            .call({ responsible: true }),
        );
      }
      const twaddrs = (await Promise.all(tws)).map(o => o.value0);
      for (let tw of twaddrs) {
        const b = Number.parseInt(await locklift.provider.getBalance(tw));
        if (b > 0) {
          const c = locklift.factory.getDeployedContract("TokenWallet", tw);
          const bal = (
            await c.methods.balance({ answerId: 0 }).call({ responsible: true })
          ).value0;
          console.log("TW", tw.toString(), "balance", bal);
        }
      }
    });
  });
});
