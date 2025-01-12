import * as React from "react";
import { useState } from "react";
import { Button, Chip, Grid, Stack, Typography } from "@mui/material";
import { featureDisabledInfo } from "./Common";
import {
  type AppState,
  type CandidateInfo,
  type CoinName,
  type Config,
  Key,
  TradeMemo,
  TradeState,
} from "../../lib";
import AssetCard from "./cards/AssetCard";
import BalanceCard from "./cards/BalanceCard";
import CandidateCard from "./cards/CandidateCard";

export function Home({
  state,
  onAssetDelete,
}: {
  state: AppState;
  onAssetDelete?: (coinName: string, noConfirm?: boolean) => void;
}): JSX.Element {
  const config = state.config;
  const assets = state.assets.map(TradeMemo.fromObject);
  const assetsValue = assets.reduce((sum, tm) => sum + tm.currentValue, 0);
  const [hideBalances, setHideBalances] = useState(config.HideBalances);

  const toggleHideBalances = (): void => {
    setHideBalances(!hideBalances);
  };

  const sorted = assets.sort((t1, t2) => (t1.ttl > t2.ttl ? 1 : -1));
  const current = sorted.filter(
    (t) => t.currentValue || t.stateIs(TradeState.BUY)
  );
  const sold = sorted.filter((t) => t.stateIs(TradeState.SOLD));

  const currentInfoMessage =
    config.AdvancedAccess && !current.length ? (
      <Typography variant="body1" textAlign={`center`}>
        {config.ViewOnly
          ? `🔕 Auto-trading is disabled. Toggle off "View-only" in Settings to activate.`
          : `⌚ Waiting for specific conditions to buy a candidate.`}
      </Typography>
    ) : undefined;

  return (
    <>
      <Grid
        sx={{ flexGrow: 1 }}
        display="flex"
        justifyContent="center"
        container
        spacing={2}
      >
        <Grid item xs={12}>
          {balanceCard(config, hideBalances, assetsValue, toggleHideBalances)}
        </Grid>
        <Grid item xs={12} md={4} order={{ xs: 2, md: 1 }}>
          {candidates(`⚖️ Candidates`, state.candidates)}
        </Grid>
        {!config.AdvancedAccess ? (
          <Grid item xs={12} md={12} order={{ xs: 1, md: 0 }}>
            {featureDisabledInfo}
          </Grid>
        ) : (
          <>
            <Grid item xs={12} md={4} order={{ xs: 1, md: 2 }}>
              {assetsCards(
                `🪙 Current`,
                current,
                hideBalances,
                config,
                currentInfoMessage
              )}
            </Grid>
            <Grid item xs={12} md={4} order={{ xs: 1, md: 3 }}>
              {assetsCards(`💸 Sold`, sold, hideBalances, config)}
            </Grid>
          </>
        )}
      </Grid>
    </>
  );
}

function balanceCard(
  config: Config,
  hideBalances: boolean,
  assetsValue: number,
  toggleHideBalances: () => void
): JSX.Element {
  const [hide, setHide] = useState(false);

  return (
    <Stack spacing={1} alignItems={`center`}>
      <Chip
        sx={{ mb: `8px` }}
        onClick={() => {
          setHide(!hide);
        }}
        label={<Typography variant={`h6`}>💰 Balance</Typography>}
      />
      {!hide && (
        <BalanceCard
          name={config.StableCoin}
          balances={{
            [config.StableCoin]: config.StableBalance,
            feesBudget: config.FeesBudget,
          }}
          assetsValue={assetsValue}
          viewOnly={config.ViewOnly}
          hide={hideBalances}
          toggleHide={toggleHideBalances}
        />
      )}
    </Stack>
  );
}

function assetsCards(
  title: string,
  elems: TradeMemo[],
  hideBalances: boolean,
  config: Config,
  topItem?: JSX.Element
): JSX.Element {
  const [hide, setHide] = useState(false);

  return (
    <Stack spacing={1} alignItems={`center`}>
      <Chip
        onClick={() => {
          setHide(!hide);
        }}
        label={
          <Typography variant={`h6`}>
            {title} ({elems.length})
          </Typography>
        }
      />
      {!hide && (
        <>
          <Grid
            container
            display="flex"
            justifyContent="center"
            spacing={2}
            ml={`-16px !important`}
          >
            {topItem && <Grid item>{topItem}</Grid>}
            {elems.map((t) => (
              <Grid key={t.getCoinName()} item>
                <AssetCard tm={t} cfg={config} hideBalances={hideBalances} />
              </Grid>
            ))}
          </Grid>
        </>
      )}
    </Stack>
  );
}

function candidates(
  title: string,
  data: Record<CoinName, CandidateInfo>
): JSX.Element {
  const candidateCoins = Object.keys(data).sort((a, b) =>
    data[a][Key.STRENGTH] > data[b][Key.STRENGTH] ? -1 : 1
  );

  const [hide, setHide] = useState(false);

  const defaultShow = 10;
  const [itemsToShow, setItemsToShow] = useState(defaultShow);
  const displayCoins = hide ? [] : candidateCoins.slice(0, itemsToShow);

  return (
    <Stack spacing={1} alignItems={`center`}>
      <Chip
        onClick={() => {
          setHide(!hide);
        }}
        label={
          <Typography variant={`h6`}>
            {title} ({candidateCoins.length})
          </Typography>
        }
      />
      {!hide && !candidateCoins.length && (
        <Typography alignSelf={`center`} variant={`body2`}>
          Nothing to show yet. Investment candidates will appear after some
          {` `}
          period of observation.
        </Typography>
      )}
      {!hide && (
        <Grid
          container
          display="flex"
          justifyContent="center"
          spacing={2}
          ml={`-16px !important`}
        >
          {displayCoins.map((coin, i) => {
            return (
              <Grid item key={coin}>
                <CandidateCard coin={coin} ci={data[coin]} />
              </Grid>
            );
          })}
        </Grid>
      )}
      {!hide && itemsToShow === defaultShow && (
        <Button
          variant="outlined"
          onClick={() => {
            setItemsToShow(candidateCoins.length);
          }}
        >
          Show more
        </Button>
      )}
      {!hide && itemsToShow !== defaultShow && (
        <Button
          variant="outlined"
          onClick={() => {
            setItemsToShow(defaultShow);
          }}
        >
          Show less
        </Button>
      )}
    </Stack>
  );
}
