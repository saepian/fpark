import { MetadataRoute } from 'next'

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: 'https://fpark.com', lastModified: new Date(), priority: 1 },
    { url: 'https://fpark.com/news', lastModified: new Date(), priority: 0.8 },
    { url: 'https://fpark.com/privacy', lastModified: new Date(), priority: 0.3 },
    { url: 'https://fpark.com/terms', lastModified: new Date(), priority: 0.3 },
  ]
}
