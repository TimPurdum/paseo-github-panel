import type { PluginTheme } from "@getpaseo/plugin";
import {
  type PluginWorkspacePanelProps,
  useRpc,
  useWorkspace,
} from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  loadImageRpc,
  loadPanelRpc,
  type GitHubPanelPayload,
  type IssueSummary,
  type PullRequestSummary,
  type ReadyPanelPayload,
  type RemoteRepository,
} from "../shared/contract";
import { isGitHubImageHost } from "../shared/image-host";
import { MarkdownBody } from "./markdown";
import { openExternal } from "./web";

const REFRESH_INTERVAL_MS = 60_000;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function repositoryPage(repository: RemoteRepository): string {
  return `https://${repository.host}/${repository.owner}/${repository.name}`;
}

function ageLabel(createdAt: string): string {
  const created = Date.parse(createdAt);
  if (!Number.isFinite(created)) return "unknown age";
  const days = Math.max(0, Math.floor((Date.now() - created) / 86_400_000));
  if (days === 0) return "today";
  if (days === 1) return "1 day ago";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} ${months === 1 ? "month" : "months"} ago`;
  const years = Math.floor(days / 365);
  return `${years} ${years === 1 ? "year" : "years"} ago`;
}

function makeStyles(theme: PluginTheme, compact: boolean) {
  const space = compact ? 8 : 12;
  const radius = compact ? 6 : 8;
  return {
    screen: { flex: 1, backgroundColor: theme.colors.surface0 },
    content: { padding: space, gap: space },
    toolbar: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6 },
    repositoryRail: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 6 },
    repositoryButton: {
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: radius,
      paddingHorizontal: 8,
      paddingVertical: 5,
    },
    repositoryButtonSelected: {
      borderColor: theme.colors.accent,
      backgroundColor: theme.colors.surface2,
    },
    repositoryText: { color: theme.colors.foregroundMuted, fontSize: 12 },
    repositoryTextSelected: { color: theme.colors.accent },
    branchBar: {
      borderLeftWidth: 3,
      borderLeftColor: theme.colors.accent,
      backgroundColor: theme.colors.surface1,
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderRadius: radius,
    },
    branchLabel: { color: theme.colors.foregroundMuted, fontSize: 11 },
    branchName: { color: theme.colors.foreground, fontSize: 14, fontWeight: "600" as const },
    search: {
      flex: 1,
      minWidth: 100,
      color: theme.colors.foreground,
      backgroundColor: theme.colors.surface1,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: radius,
      paddingHorizontal: 9,
      paddingVertical: compact ? 5 : 7,
    },
    button: {
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: radius,
      paddingHorizontal: 9,
      paddingVertical: compact ? 5 : 7,
    },
    buttonLabel: { color: theme.colors.foreground, fontSize: 12 },
    linkLabel: { color: theme.colors.accent, fontSize: 12 },
    card: {
      backgroundColor: theme.colors.surface1,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: radius,
      overflow: "hidden" as const,
    },
    pinnedCard: { borderColor: theme.colors.accent },
    cardHeader: { padding: compact ? 8 : 10, gap: 4 },
    titleRow: { flexDirection: "row" as const, alignItems: "flex-start" as const, gap: 8 },
    title: { flex: 1, color: theme.colors.foreground, fontSize: 14, fontWeight: "600" as const },
    meta: { color: theme.colors.foregroundMuted, fontSize: 11 },
    labelRail: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 4 },
    label: {
      color: theme.colors.foregroundMuted,
      backgroundColor: theme.colors.surface2,
      borderRadius: 10,
      paddingHorizontal: 6,
      paddingVertical: 2,
      fontSize: 10,
    },
    statusRail: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 6 },
    status: {
      color: theme.colors.foregroundMuted,
      backgroundColor: theme.colors.surface2,
      borderRadius: radius,
      paddingHorizontal: 6,
      paddingVertical: 3,
      fontSize: 11,
    },
    statusGood: { color: theme.colors.statusSuccess },
    statusBad: { color: theme.colors.statusDanger },
    statusWarn: { color: theme.colors.statusWarning },
    body: { padding: compact ? 8 : 10, borderTopWidth: 1, borderTopColor: theme.colors.border },
    sectionHeader: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "space-between" as const,
      paddingVertical: 5,
    },
    sectionTitle: { color: theme.colors.foreground, fontSize: 13, fontWeight: "600" as const },
    sectionCount: { color: theme.colors.foregroundMuted, fontSize: 11 },
    message: { color: theme.colors.foregroundMuted, padding: space },
    error: { color: theme.colors.statusDanger, padding: space },
    stale: {
      color: theme.colors.statusWarning,
      backgroundColor: theme.colors.surface1,
      borderRadius: radius,
      padding: 7,
      fontSize: 11,
    },
    fetched: { color: theme.colors.foregroundMuted, fontSize: 10, textAlign: "right" as const },
    image: { width: "100%" as const, minHeight: 120, resizeMode: "contain" as const },
    mdParagraph: { color: theme.colors.foreground, fontSize: 12, lineHeight: 18, marginBottom: 7 },
    mdHeading: { color: theme.colors.foreground, fontSize: 14, fontWeight: "600" as const, marginBottom: 6 },
    mdHeadingLarge: { color: theme.colors.foreground, fontSize: 16, fontWeight: "700" as const, marginBottom: 8 },
    mdListRow: { flexDirection: "row" as const, alignItems: "flex-start" as const, marginBottom: 4 },
    mdListMarker: { color: theme.colors.foregroundMuted, width: 22, fontSize: 12 },
    mdListText: { flex: 1 },
    mdCodeBlock: { backgroundColor: theme.colors.surface2, borderRadius: radius, padding: 8, marginBottom: 7 },
    mdCodeText: { color: theme.colors.foreground, fontFamily: "monospace", fontSize: 11 },
    mdQuote: { borderLeftWidth: 2, borderLeftColor: theme.colors.border, paddingLeft: 8 },
    mdRule: { height: 1, backgroundColor: theme.colors.border, marginVertical: 8 },
    mdBold: { fontWeight: "700" as const },
    mdInlineCode: { color: theme.colors.foreground, backgroundColor: theme.colors.surface2, fontFamily: "monospace" },
    mdLink: { color: theme.colors.accent },
    mdTable: { borderWidth: 1, borderColor: theme.colors.border, marginBottom: 8 },
    mdTableRow: { flexDirection: "row" as const, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
    mdTableCell: { flex: 1, padding: 5, borderRightWidth: 1, borderRightColor: theme.colors.border },
    mdTableHeader: { fontWeight: "700" as const },
    mdNested: { marginLeft: 8 },
    mdDetailsSummary: { flexDirection: "row" as const, alignItems: "flex-start" as const, gap: 4 },
    mdDetailsMarker: { color: theme.colors.foregroundMuted, width: 12 },
  };
}

type PanelStyles = ReturnType<typeof makeStyles>;

function statusTone(good: boolean, bad: boolean, styles: PanelStyles): { color: string } {
  if (good) return styles.statusGood;
  if (bad) return styles.statusBad;
  return styles.statusWarn;
}

function BodyImage({ url, alt, styles }: { url: string; alt: string; styles: PanelStyles }) {
  const callLoadImage = useRpc(loadImageRpc);
  const proxied = isGitHubImageHost(url);
  const query = useQuery({
    queryKey: ["github-panel-image", url],
    queryFn: () => callLoadImage({ url }),
    enabled: proxied,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });

  if (proxied && query.isPending) {
    return <ActivityIndicator accessibilityLabel={`Loading image ${alt || url}`} />;
  }

  if (proxied && query.isError) {
    return (
      <Pressable accessibilityRole="link" accessibilityLabel={`Open image ${alt || url}`} onPress={() => void openExternal(url)}>
        <Text style={styles.linkLabel}>Image unavailable. Open in browser.</Text>
      </Pressable>
    );
  }

  const uri = proxied
    ? `data:${query.data?.mimeType ?? "application/octet-stream"};base64,${query.data?.base64 ?? ""}`
    : url;
  return <Image accessibilityLabel={alt || "GitHub body image"} source={{ uri }} style={styles.image} />;
}

function Body({ source, styles }: { source: string; styles: PanelStyles }) {
  if (source.trim() === "") return null;
  return (
    <View style={styles.body}>
      <MarkdownBody
        source={source}
        styles={styles}
        onOpenLink={(url) => void openExternal(url)}
        renderImage={({ url, alt }) => <BodyImage url={url} alt={alt} styles={styles} />}
      />
    </View>
  );
}

function Labels({ item, styles }: { item: IssueSummary; styles: PanelStyles }) {
  if (item.labels.length === 0) return null;
  return (
    <View style={styles.labelRail}>
      {item.labels.map((label) => (
        <Text key={label.name} style={styles.label}>{label.name}</Text>
      ))}
    </View>
  );
}

function ItemRow({
  item,
  expanded,
  onToggle,
  styles,
  children,
}: {
  item: IssueSummary;
  expanded: boolean;
  onToggle: () => void;
  styles: PanelStyles;
  children?: ReactNode;
}) {
  const author = item.author?.login ?? "deleted user";
  return (
    <View style={styles.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${expanded ? "Collapse" : "Expand"} #${item.number} ${item.title}`}
        accessibilityState={{ expanded }}
        style={styles.cardHeader}
        onPress={onToggle}
      >
        <View style={styles.titleRow}>
          <Text style={styles.title}>#{item.number} {item.title}</Text>
          <Text style={styles.meta}>{expanded ? "-" : "+"}</Text>
        </View>
        <Text style={styles.meta}>by {author} | opened {ageLabel(item.createdAt)}</Text>
        <Labels item={item} styles={styles} />
        {children}
      </Pressable>
      {expanded ? (
        <>
          <Body source={item.bodyHTML} styles={styles} />
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={`Open #${item.number} in browser`}
            style={styles.cardHeader}
            onPress={() => void openExternal(item.url)}
          >
            <Text style={styles.linkLabel}>Open in browser</Text>
          </Pressable>
        </>
      ) : null}
    </View>
  );
}

function PullRequestStatus({ item, styles }: { item: PullRequestSummary; styles: PanelStyles }) {
  const checkTone = statusTone(item.checks.failed === 0 && item.checks.pending === 0, item.checks.failed > 0, styles);
  const reviewTone = statusTone(
    item.reviewDecision === "approved",
    item.reviewDecision === "changes-requested",
    styles,
  );
  const mergeTone = statusTone(item.mergeable === "mergeable", item.mergeable === "conflicting", styles);
  return (
    <View style={styles.statusRail}>
      <Text style={[styles.status, checkTone]}>
        Checks {item.checks.passed}/{item.checks.total} passed
        {item.checks.pending > 0 ? `, ${item.checks.pending} pending` : ""}
      </Text>
      <Text style={[styles.status, reviewTone]}>Review {item.reviewDecision}</Text>
      <Text style={[styles.status, mergeTone]}>Merge {item.mergeable}</Text>
    </View>
  );
}

function PinnedPullRequest({
  payload,
  styles,
}: {
  payload: ReadyPanelPayload;
  styles: PanelStyles;
}) {
  const pullRequest = payload.branchPullRequest;
  if (pullRequest === null) {
    return (
      <View style={[styles.card, styles.pinnedCard]}>
        <Text style={styles.message}>No pull request for {payload.branch.name}.</Text>
      </View>
    );
  }

  return (
    <View style={[styles.card, styles.pinnedCard]}>
      <View style={styles.cardHeader}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>#{pullRequest.number} {pullRequest.title}</Text>
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={`Open pull request #${pullRequest.number} in browser`}
            onPress={() => void openExternal(pullRequest.url)}
          >
            <Text style={styles.linkLabel}>Open</Text>
          </Pressable>
        </View>
        <Text style={styles.meta}>by {pullRequest.author?.login ?? "deleted user"}</Text>
        <Labels item={pullRequest} styles={styles} />
        <PullRequestStatus item={pullRequest} styles={styles} />
        {pullRequest.closingIssue !== null ? (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={`Open closing issue #${pullRequest.closingIssue.number}`}
            onPress={() => void openExternal(pullRequest.closingIssue?.url ?? pullRequest.url)}
          >
            <Text style={styles.linkLabel}>
              Closes #{pullRequest.closingIssue.number} {pullRequest.closingIssue.title}
            </Text>
          </Pressable>
        ) : null}
      </View>
      <Body source={pullRequest.bodyHTML} styles={styles} />
    </View>
  );
}

function Section<T extends IssueSummary>({
  title,
  items,
  search,
  renderStatus,
  styles,
}: {
  title: string;
  items: T[];
  search: string;
  renderStatus?: (item: T) => ReactNode;
  styles: PanelStyles;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set());
  const term = search.trim().toLowerCase();
  const filtered = useMemo(
    () => items.filter((item) =>
      term === "" ||
      item.title.toLowerCase().includes(term) ||
      item.author?.login.toLowerCase().includes(term) === true ||
      item.labels.some((label) => label.name.toLowerCase().includes(term)),
    ),
    [items, term],
  );

  function toggle(number: number): void {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(number)) next.delete(number);
      else next.add(number);
      return next;
    });
  }

  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${collapsed ? "Expand" : "Collapse"} ${title}`}
        accessibilityState={{ expanded: !collapsed }}
        style={styles.sectionHeader}
        onPress={() => setCollapsed((value) => !value)}
      >
        <Text style={styles.sectionTitle}>{collapsed ? "+" : "-"} {title}</Text>
        <Text style={styles.sectionCount}>{filtered.length}</Text>
      </Pressable>
      {!collapsed ? (
        <View style={{ gap: 6 }}>
          {filtered.length === 0 ? <Text style={styles.message}>No matching {title.toLowerCase()}.</Text> : null}
          {filtered.map((item) => (
            <ItemRow
              key={item.number}
              item={item}
              expanded={expanded.has(item.number)}
              onToggle={() => toggle(item.number)}
              styles={styles}
            >
              {renderStatus?.(item)}
            </ItemRow>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function NormalState({ payload, styles }: { payload: Exclude<GitHubPanelPayload, ReadyPanelPayload>; styles: PanelStyles }) {
  switch (payload.kind) {
    case "directory-missing":
      return <Text style={styles.message}>The workspace directory no longer exists: {payload.directory}</Text>;
    case "not-git":
      return <Text style={styles.message}>This workspace is not a Git checkout.</Text>;
    case "no-remote":
      return <Text style={styles.message}>This Git repository has no remotes.</Text>;
    case "unsupported-host":
      return <Text style={styles.message}>Remote {payload.remoteName} uses {payload.host}, not GitHub.</Text>;
  }
}

function ReadyPanel({
  payload,
  styles,
  search,
  onSearch,
  onRemote,
  staleMessage,
  refreshing,
  onRefresh,
}: {
  payload: ReadyPanelPayload;
  styles: PanelStyles;
  search: string;
  onSearch: (value: string) => void;
  onRemote: (remoteName: string) => void;
  staleMessage: string | null;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.repositoryRail}>
        {payload.repositories.map((repository) => {
          const selected = repository.remoteName === payload.selectedRepository.remoteName;
          return (
            <Pressable
              key={repository.remoteName}
              accessibilityRole="button"
              accessibilityLabel={`${selected ? "Selected" : "Switch to"} ${repository.remoteName} ${repository.owner}/${repository.name}`}
              accessibilityState={{ selected }}
              style={[styles.repositoryButton, selected ? styles.repositoryButtonSelected : null]}
              onPress={() => onRemote(repository.remoteName)}
            >
              <Text style={[styles.repositoryText, selected ? styles.repositoryTextSelected : null]}>
                {repository.remoteName}: {repository.owner}/{repository.name}
              </Text>
            </Pressable>
          );
        })}
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`Open ${payload.selectedRepository.owner}/${payload.selectedRepository.name} in browser`}
          style={styles.repositoryButton}
          onPress={() => void openExternal(repositoryPage(payload.selectedRepository))}
        >
          <Text style={styles.linkLabel}>Open repository</Text>
        </Pressable>
      </View>

      <View style={styles.branchBar}>
        <Text style={styles.branchLabel}>{payload.branch.kind === "detached" ? "Detached HEAD" : "Current branch"}</Text>
        <Text style={styles.branchName}>{payload.branch.name}</Text>
      </View>

      {staleMessage !== null ? <Text accessibilityRole="alert" style={styles.stale}>{staleMessage}</Text> : null}
      <PinnedPullRequest payload={payload} styles={styles} />

      <View style={styles.toolbar}>
        <TextInput
          accessibilityLabel="Filter issues and pull requests"
          value={search}
          onChangeText={onSearch}
          placeholder="Filter by title, author, or label"
          placeholderTextColor={styles.meta.color}
          autoCorrect={false}
          autoCapitalize="none"
          style={styles.search}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh GitHub panel"
          disabled={refreshing}
          style={styles.button}
          onPress={onRefresh}
        >
          <Text style={styles.buttonLabel}>{refreshing ? "Refreshing" : "Refresh"}</Text>
        </Pressable>
      </View>

      <Section title="Open issues" items={payload.issues} search={search} styles={styles} />
      <Section
        title="Open pull requests"
        items={payload.pullRequests}
        search={search}
        renderStatus={(item) => <PullRequestStatus item={item} styles={styles} />}
        styles={styles}
      />
      <Text style={styles.fetched}>Updated {new Date(payload.fetchedAt).toLocaleString()}</Text>
    </ScrollView>
  );
}

export function GitHubPanel({ theme, layout, workspaceId }: PluginWorkspacePanelProps) {
  const workspace = useWorkspace(workspaceId, (snapshot) => ({
    directory: snapshot.directory,
    projectKind: snapshot.projectKind,
  }));
  const callLoadPanel = useRpc(loadPanelRpc);
  const [remoteName, setRemoteName] = useState<string | undefined>(undefined);
  const [search, setSearch] = useState("");
  const lastGood = useRef(new Map<string, GitHubPanelPayload>());
  const directory = workspace?.directory ?? "";
  const cacheKey = `${directory}\n${remoteName ?? ""}`;
  const query = useQuery({
    queryKey: ["github-panel", directory, remoteName],
    queryFn: () => callLoadPanel({ directory, remoteName }),
    enabled: workspace !== null && directory !== "",
    refetchInterval: REFRESH_INTERVAL_MS,
    retry: false,
  });

  useEffect(() => {
    setRemoteName(undefined);
    setSearch("");
  }, [directory, workspace?.projectKind]);

  useEffect(() => {
    if (query.data !== undefined) lastGood.current.set(cacheKey, query.data);
  }, [cacheKey, query.data]);

  const styles = useMemo(() => makeStyles(theme, layout.compact), [theme, layout.compact]);

  if (workspace === null) {
    return <View style={styles.screen}><Text style={styles.message}>This workspace is no longer available.</Text></View>;
  }

  const payload = query.data ?? lastGood.current.get(cacheKey);
  if (payload === undefined) {
    if (query.isError) {
      return (
        <View style={[styles.screen, { padding: layout.compact ? 8 : 12, gap: 8 }]}>
          <Text accessibilityRole="alert" style={styles.error}>{errorMessage(query.error)}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry loading GitHub panel"
            style={styles.button}
            onPress={() => { void query.refetch(); }}
          >
            <Text style={styles.buttonLabel}>Try again</Text>
          </Pressable>
        </View>
      );
    }
    return <View style={styles.screen}><ActivityIndicator accessibilityLabel="Loading GitHub panel" color={theme.colors.foregroundMuted} /></View>;
  }

  if (payload.kind !== "ready") {
    return <View style={styles.screen}><NormalState payload={payload} styles={styles} /></View>;
  }

  return (
    <ReadyPanel
      payload={payload}
      styles={styles}
      search={search}
      onSearch={setSearch}
      onRemote={setRemoteName}
      staleMessage={query.isError ? `Showing data from ${new Date(payload.fetchedAt).toLocaleString()}. Refresh failed: ${errorMessage(query.error)}` : null}
      refreshing={query.isFetching}
      onRefresh={() => { void query.refetch(); }}
    />
  );
}
