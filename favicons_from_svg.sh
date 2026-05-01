cd ring                                                                                                                   
rsvg-convert -w 180 -h 180 icon.svg -o apple-touch-icon.png     
rsvg-convert -w 192 -h 192 icon.svg -o icon-192.png                                                                                                        
rsvg-convert -w 512 -h 512 icon.svg -o icon-512.png                                                                                                        
rsvg-convert -w 1200 -h 630 og-image.svg -o og-image.png                                                                                                   
# favicon.ico (regenerate from three sizes)                                                                                                                
rsvg-convert -w 16 -h 16 icon.svg -o /tmp/i16.png && \                                                                                                     
rsvg-convert -w 32 -h 32 icon.svg -o /tmp/i32.png && \                                                                                                     
rsvg-convert -w 48 -h 48 icon.svg -o /tmp/i48.png && \                                                                                                     
magick /tmp/i16.png /tmp/i32.png /tmp/i48.png favicon.ico                                                                                                  
