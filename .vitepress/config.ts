import { defineConfig } from "vitepress";

/**
 * VitePress 配置：课程文档站
 * 将各章节 README.md 渲染为带侧边栏的文档站，部署到 GitHub Pages。
 * @author fxbin
 */
export default defineConfig({
	lang: "zh-CN",
	title: "pi-learn",
	description: "从零构建 agent harness",
	lastUpdated: true,
	cleanUrls: true,
	srcExclude: ["README.md", "CONTRIBUTING.md"],
	ignoreDeadLinks: [/\.ts$/],
	rewrites: {
		"s01_agent_loop/README.md": "s01_agent_loop/index.md",
		"s02_tools/README.md": "s02_tools/index.md",
		"s03_edit_queue/README.md": "s03_edit_queue/index.md",
		"s04_interrupt/README.md": "s04_interrupt/index.md",
		"s05_session/README.md": "s05_session/index.md",
		"s06_compaction/README.md": "s06_compaction/index.md",
		"s07_skills/README.md": "s07_skills/index.md",
		"s08_provider/README.md": "s08_provider/index.md",
		"extras/README.md": "extras/index.md",
	},
	themeConfig: {
		nav: [
			{ text: "首页", link: "/" },
			{ text: "GitHub", link: "https://github.com/fxbin/pi-learn" },
		],
		sidebar: [
			{
				text: "正文",
				items: [
					{ text: "s01 Agent Loop", link: "/s01_agent_loop/" },
					{ text: "s02 Tools", link: "/s02_tools/" },
					{ text: "s03 Edit Queue", link: "/s03_edit_queue/" },
					{ text: "s04 Interrupt", link: "/s04_interrupt/" },
					{ text: "s05 Session", link: "/s05_session/" },
					{ text: "s06 Compaction", link: "/s06_compaction/" },
					{ text: "s07 Skills", link: "/s07_skills/" },
					{ text: "s08 Provider", link: "/s08_provider/" },
				],
			},
			{
				text: "附录",
				items: [
					{ text: "TS 急救包", link: "/appendix/ts-survival-kit" },
					{ text: "概念映射", link: "/appendix/concept-map" },
				],
			},
			{
				text: "番外",
				items: [{ text: "extensions/OAuth/TUI", link: "/extras/" }],
			},
		],
		outline: { label: "本页目录" },
		lastUpdatedText: "最后更新",
		docFooter: { prev: "上一章", next: "下一章" },
		darkModeSwitchLabel: "主题",
		sidebarMenuLabel: "菜单",
		returnToTopLabel: "回到顶部",
	},
});
