import { defineCollection, z } from "astro:content";

/**
 * 章节内容集合 schema。
 * @author fxbin
 */
export const collections = {
  chapters: defineCollection({
    schema: z.object({
      title: z.string(),
      num: z.string(),
      description: z.string(),
      order: z.number(),
      concepts: z.array(z.string()).optional(),
    }),
  }),
};
