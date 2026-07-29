import { defineConfig } from "astro/config";
import mdx from "@astrojs/mdx";
import react from "@astrojs/react";

/**
 * Astro 配置：pi-learn 机械标本馆主题文档站
 * 使用 Content Collections 管理章节，React islands 承载动态图示。
 * @author fxbin
 */
export default defineConfig({
  site: "https://fxbin.github.io",
  base: "/pi-learn",
  integrations: [mdx(), react()],
  markdown: {
    shikiConfig: {
      theme: "github-dark",
      wrap: true,
    },
  },
});
