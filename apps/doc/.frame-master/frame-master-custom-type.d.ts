// Module declarations for CSS imports
declare module "*.css" {
  const content: string;
  export default content;
}

declare module "*.mdx" {
  const MarkdownComponent: React.ComponentType;
  export default MarkdownComponent;
}
