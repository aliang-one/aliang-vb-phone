export interface VibeSessionTitleContext {
  directory?: string;
  projectName?: string;
  workspace?: string;
  shell?: string;
  timezone?: string;
  currentDate?: Date;
  filesystem?: string;
}

const templateTagRegex = /<([a-zA-Z][\w:-]*)>/g;
const pairedTemplateTagRegex =
  /<([a-zA-Z][\w:-]*)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/g;
const closingTemplateTagRegex = /<\/\s*([a-zA-Z][\w:-]*)\s*>/g;

const supportedTags = new Set([
  'environment-context',
  'cwd',
  'shell',
  'current-date',
  'timezone',
  'filesystem',
  'workspace',
]);

const normalizeTag = (value: string) =>
  value.trim().toLowerCase().replace(/_/g, '-');

const pathLeaf = (value?: string) => {
  if (!value) return undefined;
  const parts = value.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? value;
};

const innerText = (value?: string) =>
  value
    ?.replace(pairedTemplateTagRegex, ' $2 ')
    .replace(templateTagRegex, ' ')
    .replace(closingTemplateTagRegex, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const pad = (value: number) => String(value).padStart(2, '0');

const formatDate = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const titleCase = (value: string) =>
  value
    .split(/[\s:-]+/)
    .filter(Boolean)
    .map(part => part[0]?.toUpperCase() + part.slice(1))
    .join(' ');

const childTagValue = (content: string, tag: string) => {
  const pattern = new RegExp(
    `<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/\\s*${tag}\\s*>`,
    'i',
  );
  return innerText(content.match(pattern)?.[1]);
};

const resolveFilesystem = (
  body: string | undefined,
  context: VibeSessionTitleContext,
) => {
  const workspace = body
    ? childTagValue(body, 'workspace') ?? childTagValue(body, 'root')
    : undefined;
  return (
    pathLeaf(workspace) ??
    context.filesystem ??
    pathLeaf(context.workspace) ??
    'FS'
  );
};

const resolveEnvironmentContext = (
  body: string | undefined,
  context: VibeSessionTitleContext,
) => {
  const cwd = body ? childTagValue(body, 'cwd') : undefined;
  const shell = body ? childTagValue(body, 'shell') : undefined;
  const currentDate = body ? childTagValue(body, 'current_date') : undefined;
  const timezone = body ? childTagValue(body, 'timezone') : undefined;
  const workspace = body
    ? childTagValue(body, 'workspace') ??
      childTagValue(body, 'root') ??
      resolveFilesystem(childTagValue(body, 'filesystem'), context)
    : undefined;

  return [
    pathLeaf(workspace) ??
      context.workspace ??
      context.projectName ??
      pathLeaf(cwd) ??
      pathLeaf(context.directory),
    shell ?? context.shell,
    currentDate ?? formatDate(context.currentDate ?? new Date()),
    timezone ??
      context.timezone ??
      Intl.DateTimeFormat().resolvedOptions().timeZone,
  ]
    .filter(Boolean)
    .join(' · ');
};

const resolveTag = (
  tag: string,
  context: VibeSessionTitleContext,
  body?: string,
) => {
  const content = innerText(body);
  switch (tag) {
    case 'environment-context':
      return resolveEnvironmentContext(body, context);
    case 'cwd':
      return (
        pathLeaf(content) ??
        pathLeaf(context.directory) ??
        context.directory ??
        'cwd'
      );
    case 'shell':
      return content ?? context.shell ?? 'shell';
    case 'current-date':
      return content ?? formatDate(context.currentDate ?? new Date());
    case 'timezone':
      return (
        content ??
        context.timezone ??
        Intl.DateTimeFormat().resolvedOptions().timeZone ??
        'timezone'
      );
    case 'filesystem':
      return resolveFilesystem(body, context);
    case 'workspace':
      return (
        pathLeaf(content) ??
        context.workspace ??
        context.projectName ??
        pathLeaf(context.directory) ??
        'workspace'
      );
    default:
      return titleCase(tag);
  }
};

const compactWhitespace = (value: string) =>
  value
    .replace(/\s+/g, ' ')
    .replace(/\s*·\s*/g, ' · ')
    .trim();

const collectTemplateParts = (
  source: string,
  context: VibeSessionTitleContext,
) => {
  const parts: string[] = [];

  source.replace(pairedTemplateTagRegex, (_, rawTag: string, body: string) => {
    const tag = normalizeTag(rawTag);
    if (supportedTags.has(tag)) {
      parts.push(resolveTag(tag, context, body));
    }
    return '';
  });

  const sourceWithoutPairs = source.replace(pairedTemplateTagRegex, match => {
    const tagMatch = match.match(/^<([a-zA-Z][\w:-]*)/);
    return tagMatch && supportedTags.has(normalizeTag(tagMatch[1]))
      ? ' '
      : match;
  });

  sourceWithoutPairs.replace(templateTagRegex, (_, rawTag: string) => {
    const tag = normalizeTag(rawTag);
    if (supportedTags.has(tag)) {
      parts.push(resolveTag(tag, context));
    }
    return '';
  });

  return parts.filter(Boolean);
};

const stripTemplateSyntax = (source: string) =>
  source
    .replace(pairedTemplateTagRegex, (match, rawTag: string) =>
      supportedTags.has(normalizeTag(rawTag)) ? ' ' : match,
    )
    .replace(templateTagRegex, (match, rawTag: string) =>
      supportedTags.has(normalizeTag(rawTag)) ? ' ' : match,
    )
    .replace(closingTemplateTagRegex, (match, rawTag: string) =>
      supportedTags.has(normalizeTag(rawTag)) ? ' ' : match,
    )
    .trim();

export const formatVibeSessionTitle = (
  rawTitle: string,
  context: VibeSessionTitleContext = {},
) => {
  const source = rawTitle.trim();
  if (!source) return '';

  const tagMatches = [
    ...Array.from(source.matchAll(pairedTemplateTagRegex)),
    ...Array.from(source.matchAll(templateTagRegex)),
  ];
  if (!tagMatches.length) return compactWhitespace(source);

  const templateOnly = stripTemplateSyntax(source).length === 0;
  const resolved = collectTemplateParts(source, context);

  if (templateOnly) {
    return resolved.filter(Boolean).join(' · ');
  }

  const withoutPairs = source.replace(
    pairedTemplateTagRegex,
    (match, rawTag: string, body: string) => {
      const tag = normalizeTag(rawTag);
      return supportedTags.has(tag) ? resolveTag(tag, context, body) : match;
    },
  );

  return compactWhitespace(
    withoutPairs
      .replace(templateTagRegex, (match, rawTag: string) => {
        const tag = normalizeTag(rawTag);
        return supportedTags.has(tag) ? resolveTag(tag, context) : match;
      })
      .replace(closingTemplateTagRegex, (match, rawTag: string) =>
        supportedTags.has(normalizeTag(rawTag)) ? '' : match,
      ),
  );
};
