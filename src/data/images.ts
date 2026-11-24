/**
 * Single manifest of every photograph on the site.
 *
 * All current images are free-licence stock (Unsplash License) used as illustrations.
 * Replace a file in src/assets/images with the company's own photography under the same
 * name, or add a new import here, and every section that uses the key updates.
 */
import heroExhibition from '@/assets/images/hero-exhibition.jpg';
import aboutHall from '@/assets/images/about-hall.jpg';
import aboutSpace from '@/assets/images/about-space.jpg';
import serviceDesign from '@/assets/images/service-design.jpg';
import service3d from '@/assets/images/service-3d.jpg';
import serviceFabrication from '@/assets/images/service-fabrication.jpg';
import serviceInstallation from '@/assets/images/service-installation.jpg';
import serviceLighting from '@/assets/images/service-lighting.jpg';
import serviceLogistics from '@/assets/images/service-logistics.jpg';
import projectIsland from '@/assets/images/project-island.jpg';
import projectCorner from '@/assets/images/project-corner.jpg';
import projectPavilion from '@/assets/images/project-pavilion.jpg';
import projectModular from '@/assets/images/project-modular.jpg';
import projectProduct from '@/assets/images/project-product.jpg';
import projectInternational from '@/assets/images/project-international.jpg';
import contactDetail from '@/assets/images/contact-detail.jpg';

export const images = {
  heroExhibition,
  aboutHall,
  aboutSpace,
  serviceDesign,
  service3d,
  serviceFabrication,
  serviceInstallation,
  serviceLighting,
  serviceLogistics,
  projectIsland,
  projectCorner,
  projectPavilion,
  projectModular,
  projectProduct,
  projectInternational,
  contactDetail,
};

export type ImageKey = keyof typeof images;

/** Source pages of the stock photographs, kept for licence records. */
export const imageCredits: Record<ImageKey, string> = {
  heroExhibition: 'https://unsplash.com/photos/aSkpQLnmBNc',
  aboutHall: 'https://unsplash.com/photos/-wxczgsUfno',
  aboutSpace: 'https://unsplash.com/photos/uXleDDJNx_I',
  serviceDesign: 'https://unsplash.com/photos/a2l-GHJSeLI',
  service3d: 'https://unsplash.com/photos/qvN-WW6IUG0',
  serviceFabrication: 'https://unsplash.com/photos/KLW7Ql_k9Sc',
  serviceInstallation: 'https://unsplash.com/photos/68E-dFpOF0g',
  serviceLighting: 'https://unsplash.com/photos/BKYK-qSKnpk',
  serviceLogistics: 'https://unsplash.com/photos/GK8x_XCcDZg',
  projectIsland: 'https://unsplash.com/photos/MnW5VhzuKvE',
  projectCorner: 'https://unsplash.com/photos/3RqnBjabwAI',
  projectPavilion: 'https://unsplash.com/photos/ZlTkKcxRl7c',
  projectModular: 'https://unsplash.com/photos/uPYpcsbICI4',
  projectProduct: 'https://unsplash.com/photos/b7P1osXK-W0',
  projectInternational: 'https://unsplash.com/photos/hVZ6KXp3fnw',
  contactDetail: 'https://unsplash.com/photos/rM-x_2Lz3eo',
};
