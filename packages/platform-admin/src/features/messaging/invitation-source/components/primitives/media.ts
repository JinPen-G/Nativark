import media from './media.json';

export const people = media.people;
export const photos = media.photos;
export function getPerson(id: string) {
  const person = people.find((person) => person.id === id);
  if (!person) throw new Error(`Unknown example person: ${id}`);
  return person;
}
export function getPhoto(id: string) {
  const photo = photos.find((photo) => photo.id === id);
  if (!photo) throw new Error(`Unknown example photograph: ${id}`);
  return photo;
}
export function getPersonSource(id: string) {
  return getPerson(id).src;
}
export function getPortraitSource(id: string) {
  return `/media/people/portrait/${id}.svg`;
}
export function getAvatarSource(
  id: string,
  directory: 'spotlight-grid' | 'card-to-article' = 'spotlight-grid',
) {
  return `/${directory}/${getPerson(id).src.split('/').at(-1)}`;
}
